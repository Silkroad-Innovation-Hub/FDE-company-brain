import type { GatewayClient, GatewayDecision, DraftDecision } from '~/channels/remote';
import type { TodoLean } from '@librechat/data-schemas';
import type { ChannelIngestMethods } from '~/channels/ingest';
import type { PauseMethods } from '~/channels/pause';
import type { NoticeMethods } from '~/channels/notices';
import type { BrainChatFn } from '~/brain/openai';
import type { PhotonClient, PhotonInbound, PhotonLogger } from './types';
import { ingestChannelMessage } from '~/channels/ingest';
import { handlePauseCommand } from '~/channels/pause';
import { answerQuestion } from '~/channels/answer';
import { GatewayError } from '~/channels/remote';
import { deliverChannelNotices } from '~/channels/notices';
import { ThreadMemory } from '~/channels/memory';

export interface PhotonMethods extends ChannelIngestMethods, PauseMethods, NoticeMethods {
  getTodos: (user: string) => Promise<TodoLean[]>;
}

export interface PhotonDeps {
  /** When set, questions run through the API gateway (the web-chat agent); the local chat path is the fallback. */
  gateway?: GatewayClient;
  client: PhotonClient;
  methods: PhotonMethods;
  chat: BrainChatFn;
  model: string;
  vaultPath: string;
  /** `handle` is the phone/email registered as the project's user in the Photon dashboard. */
  owner: { user: string; handle: string };
  logger: PhotonLogger;
  now?: () => Date;
}

export type PhotonOutcome =
  | 'group'
  | 'stranger'
  | 'duplicate'
  | 'acknowledged'
  | 'decided'
  | 'paused'
  | 'answered'
  | 'failed';

export interface PhotonConnectorHandle {
  /** Settles when the inbound stream ends; rejects so a supervisor restarts the process. */
  done: Promise<void>;
  stop: () => Promise<void>;
}

export type PhotonSend = (handle: string, text: string) => Promise<string | undefined>;

const SURFACE_LABEL = 'iMessage';
const VIA = 'photon';
const SEND_COMMAND =
  /^\s*(?:yes[,!. ]*\s*)?(?:send(?:\s+it)?|approve(?:d)?|ship\s+it|go\s+ahead)\s*[.!]*\s*$/i;
const SCRAP_COMMAND =
  /^\s*(?:no[,!. ]*\s*)?(?:scrap(?:\s+it)?|cancel(?:\s+it)?|delete(?:\s+it)?|don'?t\s+send(?:\s+it)?|deny)\s*[.!]*\s*$/i;
const DECISION_REPLIES: Record<GatewayDecision['outcome'], (d: GatewayDecision) => string> = {
  sent: (d) => `Sent to ${d.to ?? 'them'}${d.subject ? ` — "${d.subject}"` : ''}.`,
  deleted: () => 'Scrapped — the draft is deleted.',
  none: () => 'Nothing is waiting to send.',
};

/** "send" / "scrap it" as a whole text — the owner deciding the latest draft. */
export function parseDraftDecision(text: string): DraftDecision | null {
  if (SEND_COMMAND.test(text)) {
    return 'approved';
  }
  return SCRAP_COMMAND.test(text) ? 'denied' : null;
}
const SHARED_LINE = 'shared';

/** The shared pool reports its line as the literal `shared`; label it as the agent's number. */
export function describeLine(line: string): string {
  return line === SHARED_LINE ? 'Photon line' : line;
}
const PHONE_NOISE = /[\s\-().]/g;

/** Phones as Apple delivers them vs as a human types them: compare without formatting noise. */
export function normalizePhotonHandle(handle: string): string {
  const lower = handle.trim().toLowerCase();
  return lower.includes('@') ? lower : lower.replace(PHONE_NOISE, '');
}

export function messageId(id: string): string {
  return `photon-${id}`;
}

export function threadId(spaceId: string): string {
  return `photon:${spaceId}`;
}

/** The connector can only ever message the owner; any other recipient is refused before the SDK sees it. */
export function ownerOnlySender(ownerHandle: string, client: PhotonClient): PhotonSend {
  const owner = normalizePhotonHandle(ownerHandle);
  return (handle, text) => {
    if (normalizePhotonHandle(handle) !== owner) {
      return Promise.reject(new Error(`Photon send refused: ${handle} is not the owner handle`));
    }
    return client.send(handle, text);
  };
}

function isOwner(deps: PhotonDeps, message: PhotonInbound): boolean {
  return normalizePhotonHandle(message.sender) === normalizePhotonHandle(deps.owner.handle);
}

async function logOutbound(
  deps: PhotonDeps,
  message: PhotonInbound,
  text: string,
  sentId: string | undefined,
): Promise<void> {
  const id = sentId ?? `out-${message.id}`;
  await ingestChannelMessage(deps.methods, deps.owner.user, {
    surface: 'imessage',
    direction: 'outbound',
    messageId: messageId(id),
    conversationId: threadId(message.spaceId),
    text,
    sender: describeLine(message.line),
  });
}

/** Gateway first (same agent as web chat); null means "do not reply" (paused / gateway down). */
async function answerFor(
  deps: PhotonDeps,
  message: PhotonInbound,
  memory: ThreadMemory,
): Promise<string | null> {
  if (!deps.gateway) {
    return answerQuestion(
      {
        chat: deps.chat,
        model: deps.model,
        vaultPath: deps.vaultPath,
        methods: deps.methods,
        now: deps.now,
      },
      {
        user: deps.owner.user,
        question: message.text,
        history: memory.history(message.spaceId),
        surface: SURFACE_LABEL,
      },
    );
  }
  try {
    const reply = await deps.gateway.answer({
      surface: 'imessage',
      externalThreadId: threadId(message.spaceId),
      question: message.text,
      sender: message.sender,
      subject: `iMessage ${describeLine(message.line)}`,
      format: 'plain',
    });
    return reply.text;
  } catch (error) {
    if (error instanceof GatewayError && error.kind === 'paused') {
      deps.logger.info('[photon] gateway paused — not answering');
      return null;
    }
    deps.logger.error('[photon] gateway answer failed', error);
    return null;
  }
}

async function respond(
  deps: PhotonDeps,
  message: PhotonInbound,
  memory: ThreadMemory,
  send: PhotonSend,
): Promise<PhotonOutcome> {
  const ack = await handlePauseCommand(deps.methods, deps.owner.user, message.text, VIA);
  if (ack != null) {
    const sentId = await send(message.sender, ack);
    await logOutbound(deps, message, ack, sentId);
    deps.logger.info(`[photon] kill switch: ${ack}`);
    return 'acknowledged';
  }
  if (await deps.methods.isChannelsPaused(deps.owner.user)) {
    deps.logger.info('[photon] paused — not answering');
    return 'paused';
  }
  const decision = parseDraftDecision(message.text);
  if (decision && deps.gateway) {
    const result = await deps.gateway.decide(decision);
    const reply = DECISION_REPLIES[result.outcome](result);
    const sentId = await send(message.sender, reply);
    await logOutbound(deps, message, reply, sentId);
    deps.logger.info(`[photon] draft ${decision}: ${result.outcome}`);
    return 'decided';
  }
  const answer = await deps.client.respondingIn(message.sender, () =>
    answerFor(deps, message, memory),
  );
  if (answer == null) {
    return 'paused';
  }
  const sentId = await send(message.sender, answer);
  await logOutbound(deps, message, answer, sentId);
  memory.remember(message.spaceId, { fromOwner: true, text: message.text });
  memory.remember(message.spaceId, { fromOwner: false, text: answer });
  deps.logger.info(`[photon] replied to ${message.sender}: ${answer.slice(0, 80)}`);
  return 'answered';
}

/**
 * One inbound text: owner-only gate, idempotent raw-log append, kill switch, answer.
 * Strangers and group chats are dropped before the log — a stranger texting a bot is
 * not company data and is an injection surface (brief §6).
 */
export async function processPhotonMessage(
  deps: PhotonDeps,
  message: PhotonInbound,
  memory: ThreadMemory,
  send: PhotonSend = ownerOnlySender(deps.owner.handle, deps.client),
): Promise<PhotonOutcome> {
  if (message.kind === 'group') {
    deps.logger.info(`[photon] ignored group chat ${message.spaceId}`);
    return 'group';
  }
  if (!isOwner(deps, message)) {
    deps.logger.warn(`[photon] dropped non-owner ${message.sender}`);
    return 'stranger';
  }
  const { fresh } = await ingestChannelMessage(deps.methods, deps.owner.user, {
    surface: 'imessage',
    direction: 'inbound',
    messageId: messageId(message.id),
    conversationId: threadId(message.spaceId),
    text: message.text,
    sender: message.sender,
    subject: `iMessage ${describeLine(message.line)}`,
  });
  if (!fresh) {
    return 'duplicate';
  }
  deps.logger.info(`[photon] ingested ${message.id}: ${message.text.slice(0, 60)}`);
  try {
    return await respond(deps, message, memory, send);
  } catch (error) {
    deps.logger.error('[photon] reply failed', error);
    return 'failed';
  }
}

/** Delivers pending owner notices into the owner's DM through the guarded sender. */
export async function deliverPhotonNotices(
  deps: PhotonDeps,
  send: PhotonSend = ownerOnlySender(deps.owner.handle, deps.client),
): Promise<number> {
  return deliverChannelNotices({
    methods: deps.methods,
    user: deps.owner.user,
    via: VIA,
    send: async (text) => {
      await send(deps.owner.handle, text);
    },
    logger: deps.logger,
  });
}

/**
 * Consumes the inbound stream one message at a time and delivers notices on a timer.
 * The SDK's reconnect behaviour is undocumented, so a stream that ends or throws rejects
 * `done` and the runner exits non-zero for pm2 / compose to restart it.
 */
export function startPhotonConnector(
  deps: PhotonDeps & { noticeMs: number },
): PhotonConnectorHandle {
  const memory = new ThreadMemory();
  const send = ownerOnlySender(deps.owner.handle, deps.client);
  let delivering = false;
  const tick = async () => {
    if (delivering) {
      return;
    }
    delivering = true;
    try {
      await deliverPhotonNotices(deps, send);
    } catch (error) {
      deps.logger.error('[photon] notice delivery failed', error);
    } finally {
      delivering = false;
    }
  };
  const timer = setInterval(tick, deps.noticeMs);
  const consume = async () => {
    for await (const message of deps.client.messages()) {
      await processPhotonMessage(deps, message, memory, send);
    }
    throw new Error('Photon inbound stream ended');
  };
  const done = consume().finally(() => clearInterval(timer));
  return {
    done,
    stop: async () => {
      clearInterval(timer);
      await deps.client.stop();
    },
  };
}
