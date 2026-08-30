import type { TodoLean } from '@librechat/data-schemas';
import type { GmailApi, GmailProfile } from './client';
import type { ChannelIngestMethods } from '~/channels/ingest';
import type { BrainWorkerLogger } from '~/brain/worker';
import type { PauseMethods } from '~/channels/pause';
import type { BrainChatFn } from '~/brain/openai';
import type { AnswerTurn } from '~/channels/answer';
import type { ParsedMail } from './parse';
import { ingestChannelMessage } from '~/channels/ingest';
import { handlePauseCommand } from '~/channels/pause';
import { answerQuestion } from '~/channels/answer';
import { HistoryExpiredError } from './client';
import { parseGmailMessage } from './parse';

export interface GmailPollState {
  historyId: string;
}

export interface GmailPollStore {
  load: () => GmailPollState | null;
  save: (state: GmailPollState) => void;
}

export interface GmailPollMethods extends ChannelIngestMethods, PauseMethods {
  getTodos: (user: string) => Promise<TodoLean[]>;
}

export interface GmailPollDeps {
  api: GmailApi;
  methods: GmailPollMethods;
  chat: BrainChatFn;
  model: string;
  vaultPath: string;
  owner: { user: string; email: string };
  logger: BrainWorkerLogger;
  store: GmailPollStore;
  backfill?: number;
  now?: () => Date;
}

export type GmailMailOutcome =
  | 'duplicate'
  | 'empty'
  | 'logged'
  | 'answered'
  | 'acknowledged'
  | 'paused'
  | 'failed';

const QUESTION_PREFIX = /^\s*silkroad:/i;
const MAX_THREAD_TURNS = 8;
const RECENT_FALLBACK_LIMIT = 50;

function ownerAddress(deps: GmailPollDeps): string {
  return deps.owner.email.trim().toLowerCase();
}

/** A self-addressed email, or one whose subject starts with `Silkroad:`, is a question for the agent. */
export function isOwnerQuestion(mail: ParsedMail, ownerEmail: string): boolean {
  const owner = ownerEmail.trim().toLowerCase();
  if (mail.isAgent || mail.fromAddress !== owner) {
    return false;
  }
  if (QUESTION_PREFIX.test(mail.subject)) {
    return true;
  }
  return mail.to.length > 0 && mail.to.every((recipient) => recipient === owner);
}

function replySubject(subject: string): string {
  const bare = subject.replace(QUESTION_PREFIX, '').trim();
  return /^re:/i.test(bare) ? bare : `Re: ${bare}`;
}

/** Per-process thread memory so follow-up questions in one thread see earlier turns. */
export class ThreadMemory {
  private readonly turns = new Map<string, AnswerTurn[]>();

  remember(threadId: string, turn: AnswerTurn): void {
    const history = this.turns.get(threadId) ?? [];
    history.push(turn);
    this.turns.set(threadId, history.slice(-MAX_THREAD_TURNS));
  }

  history(threadId: string): AnswerTurn[] {
    return [...(this.turns.get(threadId) ?? [])];
  }
}

async function replyToOwner(deps: GmailPollDeps, mail: ParsedMail, text: string): Promise<void> {
  await deps.api.sendReply({
    to: deps.owner.email,
    subject: replySubject(mail.subject),
    text,
    threadId: mail.threadId,
    inReplyTo: mail.rfcMessageId,
    references: mail.references,
  });
}

async function respond(
  deps: GmailPollDeps,
  mail: ParsedMail,
  memory: ThreadMemory,
): Promise<GmailMailOutcome> {
  const question = mail.text.trim();
  const ack = await handlePauseCommand(deps.methods, deps.owner.user, question, 'email');
  if (ack != null) {
    await replyToOwner(deps, mail, ack);
    return 'acknowledged';
  }
  if (await deps.methods.isChannelsPaused(deps.owner.user)) {
    return 'paused';
  }
  const history = memory.history(mail.threadId);
  const answer = await answerQuestion(
    {
      chat: deps.chat,
      model: deps.model,
      vaultPath: deps.vaultPath,
      methods: deps.methods,
      now: deps.now,
    },
    { user: deps.owner.user, question, history, surface: 'email' },
  );
  await replyToOwner(deps, mail, answer);
  memory.remember(mail.threadId, { fromOwner: true, text: question });
  memory.remember(mail.threadId, { fromOwner: false, text: answer });
  return 'answered';
}

/**
 * Logs one parsed email (received, owner-sent, or agent-sent) and answers it
 * when it is a question from the owner. Third parties are never replied to.
 */
export async function processMail(
  deps: GmailPollDeps,
  mail: ParsedMail,
  memory: ThreadMemory,
): Promise<GmailMailOutcome> {
  const { fresh, entry } = await ingestChannelMessage(deps.methods, deps.owner.user, {
    surface: 'email',
    direction: mail.isAgent ? 'outbound' : 'inbound',
    messageId: `gmail-${mail.messageId}`,
    conversationId: mail.threadId,
    text: mail.text,
    sender: mail.from,
    subject: mail.subject,
    bulk: mail.isBulk,
  });
  if (entry == null) {
    return 'empty';
  }
  if (!fresh) {
    return 'duplicate';
  }
  if (!isOwnerQuestion(mail, ownerAddress(deps))) {
    return 'logged';
  }
  try {
    return await respond(deps, mail, memory);
  } catch (error) {
    deps.logger.error(`gmail: reply failed for ${mail.messageId}`, error);
    return 'failed';
  }
}

async function fetchParsed(deps: GmailPollDeps, ids: string[]): Promise<ParsedMail[]> {
  const messages = await Promise.all(
    ids.map(async (id) => {
      try {
        return parseGmailMessage(await deps.api.getMessage(id));
      } catch (error) {
        deps.logger.error(`gmail: fetch failed for ${id}`, error);
        return null;
      }
    }),
  );
  return messages
    .filter((mail): mail is ParsedMail => mail != null)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

/** Fetches, logs and (for owner questions) answers a batch of message ids in date order. */
export async function processMessages(
  deps: GmailPollDeps,
  ids: string[],
  memory: ThreadMemory,
): Promise<number> {
  const mails = await fetchParsed(deps, ids);
  for (const mail of mails) {
    const outcome = await processMail(deps, mail, memory);
    if (outcome !== 'duplicate' && outcome !== 'empty') {
      deps.logger.info(
        `gmail: ${outcome} — ${mail.subject || '(no subject)'} from ${mail.fromAddress}`,
      );
    }
  }
  return mails.length;
}

async function resetState(
  deps: GmailPollDeps,
): Promise<{ state: GmailPollState; profile: GmailProfile }> {
  const profile = await deps.api.getProfile();
  const state = { historyId: profile.historyId };
  deps.store.save(state);
  return { state, profile };
}

/** Loads the saved cursor or starts at "now" (optionally backfilling recent mail once). */
export async function initialState(
  deps: GmailPollDeps,
  memory: ThreadMemory,
): Promise<GmailPollState> {
  const saved = deps.store.load();
  if (saved?.historyId) {
    return saved;
  }
  const { state, profile } = await resetState(deps);
  deps.logger.info(`gmail: fresh start for ${profile.emailAddress} at history ${state.historyId}`);
  if (deps.backfill && deps.backfill > 0) {
    const ids = await deps.api.listRecent(deps.backfill);
    await processMessages(deps, ids, memory);
  }
  return state;
}

/** One incremental sync; falls back to a recent-mail scan when Gmail has expired the history. */
export async function syncOnce(
  deps: GmailPollDeps,
  state: GmailPollState,
  memory: ThreadMemory,
): Promise<GmailPollState> {
  try {
    const { messageIds, historyId } = await deps.api.listHistory(state.historyId);
    await processMessages(deps, messageIds, memory);
    const next = { historyId };
    if (next.historyId !== state.historyId) {
      deps.store.save(next);
    }
    return next;
  } catch (error) {
    if (!(error instanceof HistoryExpiredError)) {
      throw error;
    }
    deps.logger.warn('gmail: history expired, rescanning recent mail');
    const { state: next } = await resetState(deps);
    const ids = await deps.api.listRecent(RECENT_FALLBACK_LIMIT);
    await processMessages(deps, ids, memory);
    return next;
  }
}

export interface GmailPollerHandle {
  stop: () => void;
}

export async function startGmailPoller(
  deps: GmailPollDeps & { intervalMs: number; once?: boolean },
): Promise<GmailPollerHandle> {
  const memory = new ThreadMemory();
  let state = await initialState(deps, memory);
  let running = false;
  const tick = async () => {
    if (running) {
      return;
    }
    running = true;
    try {
      state = await syncOnce(deps, state, memory);
    } catch (error) {
      deps.logger.error('gmail: poll failed', error);
    } finally {
      running = false;
    }
  };
  await tick();
  if (deps.once) {
    return { stop: () => undefined };
  }
  const timer = setInterval(tick, deps.intervalMs);
  return { stop: () => clearInterval(timer) };
}
