import type { BrainLogLean, BrainLogAppendData } from '@librechat/data-schemas';

export type ChannelSurface = 'email' | 'imessage';

export interface ChannelMessage {
  surface: ChannelSurface;
  /** `inbound` = written by a human (owner or third party); `outbound` = written by the agent. */
  direction: 'inbound' | 'outbound';
  messageId: string;
  conversationId?: string;
  text: string;
  sender?: string;
  subject?: string;
  /** Newsletter/notification mail: logged for search, never sent to a model. */
  bulk?: boolean;
}

export interface ChannelIngestMethods {
  appendBrainLog: (user: string, data: BrainLogAppendData) => Promise<BrainLogLean | null>;
}

export interface ChannelIngestResult {
  entry: BrainLogLean | null;
  /** False when this messageId had already been logged (re-poll, backfill overlap). */
  fresh: boolean;
}

const MIN_TEXT_LENGTH = 2;

function isFreshEntry(entry: BrainLogLean | null): boolean {
  if (!entry?.createdAt || !entry.updatedAt) {
    return false;
  }
  return new Date(entry.createdAt).getTime() === new Date(entry.updatedAt).getTime();
}

/**
 * The synchronous half of ingestion for external surfaces: a dumb, idempotent
 * raw-log append. No model runs here — triage, to-dos and distillation happen
 * in the worker (context/ingestion.md, context/channels.md).
 */
export async function ingestChannelMessage(
  methods: ChannelIngestMethods,
  user: string,
  message: ChannelMessage,
): Promise<ChannelIngestResult> {
  const text = message.text.trim();
  if (text.length < MIN_TEXT_LENGTH) {
    return { entry: null, fresh: false };
  }
  const entry = await methods.appendBrainLog(user, {
    surface: message.surface,
    direction: message.direction,
    messageId: message.messageId,
    conversationId: message.conversationId,
    text,
    sender: message.sender,
    subject: message.subject,
    ...(message.bulk
      ? { resolution: { status: 'skipped', outcome: 'bulk', reason: 'Bulk mail' } }
      : {}),
  });
  return { entry, fresh: isFreshEntry(entry) };
}
