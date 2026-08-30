import type { BrainChatFn } from '~/brain/openai';
import type { ChannelIngestMethods } from '~/channels/ingest';
import type { PauseMethods } from '~/channels/pause';
import type { AnswerTurn } from '~/channels/answer';
import type { SqlRunner, MessageRow } from './db';
import { fetchNewMessages, fetchOwnHandles, fetchThreadHistory } from './db';
import { ingestChannelMessage } from '~/channels/ingest';
import { handlePauseCommand } from '~/channels/pause';
import { answerQuestion } from '~/channels/answer';
import { messageText } from './decode';

/** Prefix on every agent reply so the connector never re-ingests or re-answers its own text. */
export const AGENT_MARKER = '🧠';

const HISTORY_TURNS = 8;
const HISTORY_CHARS = 400;
const SURFACE_LABEL = 'iMessage';
const SHORT_CODE = /^\d{4,6}$/;
const BULK_FOOTER =
  /\b(?:reply|text)\s+stop\b|\bstop\s+to\s+(?:end|opt\s*out|unsubscribe|cancel)\b|\bunsubscribe\b|\bopt\s*out\b/i;

export interface ImessageLogger {
  info: (message: string) => void;
  error: (message: string, error?: unknown) => void;
}

export interface ImessageMethods extends ChannelIngestMethods, PauseMethods {
  getTodos: Parameters<typeof answerQuestion>[0]['methods']['getTodos'];
}

/** Sends `text` to `handle`; implementations must reject handles outside the own-handle set. */
export type ImessageSend = (handle: string, text: string) => void;

export interface ImessageDeps {
  sql: SqlRunner;
  send: ImessageSend;
  methods: ImessageMethods;
  chat: BrainChatFn;
  model: string;
  vaultPath: string;
  user: string;
  ownHandles: Set<string>;
  logger: ImessageLogger;
  now?: () => Date;
}

export interface ImessageState {
  lastRowId: number;
}

/** Own account handles plus any configured extras, normalised for comparison. */
export function resolveOwnHandles(sql: SqlRunner, extra: string): Set<string> {
  const configured = extra
    .split(',')
    .map((handle) => handle.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...fetchOwnHandles(sql), ...configured]);
}

/** Marketing/notification SMS: short-code senders or STOP/unsubscribe footers. Logged, never triaged. */
export function isBulkText(row: MessageRow, text: string): boolean {
  if (row.is_from_me === 1) {
    return false;
  }
  return SHORT_CODE.test(String(row.handle ?? '').trim()) || BULK_FOOTER.test(text);
}

/**
 * Wraps a raw sender with the own-handle guard and the loop-prevention
 * marker: the connector can only ever message the owner.
 */
export function guardedSender(ownHandles: Set<string>, send: ImessageSend): ImessageSend {
  return (handle, text) => {
    if (!ownHandles.has(handle.toLowerCase())) {
      throw new Error(`iMessage send refused: ${handle} is not an owner handle`);
    }
    send(handle, `${AGENT_MARKER} ${text}`);
  };
}

function isAgentReply(text: string): boolean {
  return text.startsWith(AGENT_MARKER);
}

/** The agent chat is the owner's self-conversation (chat identifier is an own handle). */
export function isAgentChat(row: MessageRow, ownHandles: Set<string>): boolean {
  const chat = String(row.chat_name ?? '').toLowerCase();
  const sender = String(row.handle ?? '').toLowerCase();
  return ownHandles.has(chat) || (row.is_from_me !== 1 && ownHandles.has(sender));
}

function replyTarget(row: MessageRow): string | null {
  return (row.is_from_me === 1 ? row.chat_name || row.handle : row.handle) ?? null;
}

export function threadHistory(sql: SqlRunner, row: MessageRow): AnswerTurn[] {
  if (!row.chat_guid) {
    return [];
  }
  return fetchThreadHistory(sql, row.chat_guid, row.rowid, HISTORY_TURNS)
    .map((history) => {
      const text = messageText(history.text, history.body_hex);
      if (!text) {
        return null;
      }
      const fromAgent = isAgentReply(text);
      return {
        fromOwner: history.is_from_me === 1 && !fromAgent,
        text: text.slice(0, HISTORY_CHARS),
      };
    })
    .filter((turn): turn is AnswerTurn => turn != null)
    .reverse();
}

async function respond(deps: ImessageDeps, row: MessageRow, text: string): Promise<void> {
  const target = replyTarget(row);
  if (!target) {
    return;
  }
  const ack = await handlePauseCommand(deps.methods, deps.user, text, 'imessage');
  if (ack) {
    deps.send(target, ack);
    deps.logger.info(`[imessage] kill switch: ${ack}`);
    return;
  }
  if (await deps.methods.isChannelsPaused(deps.user)) {
    deps.logger.info('[imessage] paused — not answering');
    return;
  }
  const answer = await answerQuestion(
    {
      chat: deps.chat,
      model: deps.model,
      vaultPath: deps.vaultPath,
      methods: deps.methods,
      now: deps.now,
    },
    {
      user: deps.user,
      question: text,
      history: threadHistory(deps.sql, row),
      surface: SURFACE_LABEL,
    },
  );
  deps.send(target, answer);
  deps.logger.info(`[imessage] replied in ${target}: ${answer.slice(0, 80)}`);
}

/** Ingests one batch of rows and answers owner questions; returns the highest ROWID seen. */
export async function processRows(deps: ImessageDeps, rows: MessageRow[]): Promise<number> {
  let last = 0;
  for (const row of rows) {
    last = Math.max(last, row.rowid);
    const text = messageText(row.text, row.body_hex);
    if (!text) {
      continue;
    }
    const fromAgent = isAgentReply(text);
    const { fresh } = await ingestChannelMessage(deps.methods, deps.user, {
      surface: 'imessage',
      direction: fromAgent ? 'outbound' : 'inbound',
      messageId: `imessage-${row.guid}`,
      conversationId: row.chat_guid ?? undefined,
      text,
      sender: row.handle ?? undefined,
      subject: row.chat_name ?? undefined,
      bulk: isBulkText(row, text),
    });
    if (!fresh) {
      continue;
    }
    deps.logger.info(`[imessage] ingested #${row.rowid}: ${text.slice(0, 60)}`);
    if (fromAgent || !isAgentChat(row, deps.ownHandles)) {
      continue;
    }
    try {
      await respond(deps, row, text);
    } catch (error) {
      deps.logger.error('[imessage] reply failed', error);
    }
  }
  return last;
}

/** One poll: fetch rows after the cursor, process them, and return the advanced state. */
export async function pollOnce(deps: ImessageDeps, state: ImessageState): Promise<ImessageState> {
  const rows = fetchNewMessages(deps.sql, state.lastRowId);
  if (rows.length === 0) {
    return state;
  }
  const last = await processRows(deps, rows);
  return last > state.lastRowId ? { lastRowId: last } : state;
}
