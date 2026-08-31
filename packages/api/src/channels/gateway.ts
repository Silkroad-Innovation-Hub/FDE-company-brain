import { randomUUID } from 'crypto';
import type { ChannelThreadLean, ChannelThreadKey } from '@librechat/data-schemas';
import type { GatewayAnswerRequest, GatewayAnswer } from './remote';
import type { ChannelAudit } from './audit';

export interface GatewayMethods {
  getChannelThread: (user: string, key: ChannelThreadKey) => Promise<ChannelThreadLean | null>;
  upsertChannelThread: (
    user: string,
    key: ChannelThreadKey,
    data: { conversationId: string; lastMessageId?: string; title?: string },
  ) => Promise<ChannelThreadLean>;
  isChannelsPaused: (user: string) => Promise<boolean>;
  /** Names an untitled mirrored conversation after the channel; the auto-titler may still overwrite it. */
  setConversationTitle?: (user: string, conversationId: string, title: string) => Promise<void>;
}

export interface GatewayDeps {
  /** Base URL of this API server, e.g. http://127.0.0.1:3080 */
  baseUrl: string;
  /** Mints a short-lived JWT for the owner so the loopback runs as them. */
  ownerToken: () => Promise<string>;
  methods: GatewayMethods;
  spec: string;
  endpoint: string;
  logger: { info: (message: string) => void; warn: (message: string) => void };
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  /** Per-turn graph-step budget for channel answers (brief §6 blast-radius cap). */
  turnBudget?: number;
  audit?: ChannelAudit;
}

export interface GatewayRequest extends GatewayAnswerRequest {
  user: string;
}

export class GatewayPausedError extends Error {}
export class GatewayRunError extends Error {}

interface StartResponse {
  streamId: string;
  conversationId: string;
  generationCreatedAt?: number;
}

interface StreamMessage {
  messageId?: string;
  text?: string;
  content?: Array<{ type?: string; text?: string | { value?: string } }>;
  unfinished?: boolean;
}

interface StreamEvent {
  final?: boolean;
  error?: unknown;
  title?: string;
  responseMessage?: StreamMessage;
  conversation?: { conversationId?: string; title?: string };
}

const UNTITLED = new Set(['', 'New Chat']);

function isUntitled(event: StreamEvent): boolean {
  const title = (event.title ?? event.conversation?.title ?? '').trim();
  return UNTITLED.has(title);
}

const DEFAULT_TIMEOUT_MS = 90_000;
/** The chat route rejects non-browser agents (uaParser); the gateway identifies as a browser-class client. */
const GATEWAY_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 SilkroadGateway/1.0';
const CHAT_PATH = '/api/agents/chat';
const SURFACE_LABELS: Record<GatewayAnswerRequest['surface'], string> = {
  imessage: 'iMessage',
  email: 'Email',
};

function textOf(message: StreamMessage | undefined): string {
  if (!message) {
    return '';
  }
  if (typeof message.text === 'string' && message.text.trim().length > 0) {
    return message.text.trim();
  }
  return (message.content ?? [])
    .filter((part) => part.type === 'text')
    .map((part) => (typeof part.text === 'string' ? part.text : (part.text?.value ?? '')))
    .join('\n')
    .trim();
}

/** Markdown → text a phone renders well: no headings, emphasis, links, or code fences. */
export function toPlainText(markdown: string): string {
  return markdown
    .replace(/```[a-z]*\n?([\s\S]*?)```/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(^|\s)\*([^*\n]+)\*/g, '$1$2')
    .replace(/(^|\s)_([^_\n]+)_/g, '$1$2')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1 ($2)')
    .replace(
      /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g,
      (_m, target: string, alias?: string) => (alias && alias.length > 0 ? alias : target),
    )
    .replace(/^[ \t]*[-*+][ \t]+/gm, '- ')
    .replace(/^[ \t]*(\d+)\.[ \t]+/gm, '$1. ')
    .replace(/^[ \t]*>[ \t]?/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function* sseEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<{ event: string; data: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const raw = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      let event = 'message';
      const data: string[] = [];
      for (const line of raw.split('\n')) {
        if (line.startsWith('event:')) {
          event = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          data.push(line.slice(5).trimStart());
        }
      }
      if (data.length > 0) {
        yield { event, data: data.join('\n') };
      }
      boundary = buffer.indexOf('\n\n');
    }
  }
}

function parseEvent(data: string): StreamEvent | null {
  try {
    return JSON.parse(data) as StreamEvent;
  } catch {
    return null;
  }
}

async function readJson<T>(response: Response, what: string): Promise<T> {
  const body = await response.text().catch(() => '');
  if (!response.ok) {
    throw new GatewayRunError(`${what} failed: ${response.status} ${body.slice(0, 200)}`);
  }
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new GatewayRunError(`${what} rejected: ${body.replace(/\s+/g, ' ').slice(0, 200)}`);
  }
}

/**
 * Answers a channel question by running the owner's own web-chat spec through
 * the real chat pipeline (tools, subagents, persistence, titles, usage), so a
 * text and a web chat are the same agent. Each external thread maps to one
 * conversation that then shows up in the web UI.
 */
export async function answerViaChat(
  deps: GatewayDeps,
  request: GatewayRequest,
): Promise<GatewayAnswer> {
  if (await deps.methods.isChannelsPaused(request.user)) {
    throw new GatewayPausedError('channels are paused');
  }
  const fetchFn = deps.fetchFn ?? fetch;
  const key: ChannelThreadKey = {
    surface: request.surface,
    externalThreadId: request.externalThreadId,
  };
  const thread = await deps.methods.getChannelThread(request.user, key);
  const conversationId = thread?.conversationId ?? randomUUID();
  const parentMessageId = thread?.lastMessageId ?? '00000000-0000-0000-0000-000000000000';
  const token = await deps.ownerToken();
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    'User-Agent': GATEWAY_USER_AGENT,
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const base = deps.baseUrl.replace(/\/+$/, '');

  try {
    const started = await readJson<StartResponse>(
      await fetchFn(`${base}${CHAT_PATH}/${deps.endpoint}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          text: request.question,
          spec: deps.spec,
          endpoint: deps.endpoint,
          conversationId,
          parentMessageId,
          isCreatedByUser: true,
          sender: 'User',
          clientRequestId: `channel-${request.surface}-${randomUUID()}`,
          ...(deps.turnBudget ? { ephemeralAgent: { recursion_limit: deps.turnBudget } } : {}),
        }),
        signal: controller.signal,
      }),
      'start generation',
    );
    const streamUrl = new URL(`${base}${CHAT_PATH}/stream/${started.streamId}`);
    if (started.generationCreatedAt != null) {
      streamUrl.searchParams.set('generationCreatedAt', String(started.generationCreatedAt));
    }
    const stream = await fetchFn(streamUrl.toString(), { headers, signal: controller.signal });
    if (!stream.ok || !stream.body) {
      throw new GatewayRunError(`stream failed: ${stream.status}`);
    }
    let final: StreamEvent | null = null;
    for await (const { event, data } of sseEvents(stream.body)) {
      const parsed = parseEvent(data);
      if (!parsed) {
        continue;
      }
      if (event === 'error' || (parsed.error != null && !parsed.final)) {
        throw new GatewayRunError(
          `generation error: ${JSON.stringify(parsed.error ?? parsed).slice(0, 200)}`,
        );
      }
      if (parsed.final === true) {
        final = parsed;
        break;
      }
    }
    if (!final) {
      throw new GatewayRunError('stream ended without a final event');
    }
    const answerText = textOf(final.responseMessage);
    const messageId = final.responseMessage?.messageId ?? '';
    const finalConversationId =
      started.conversationId ?? final.conversation?.conversationId ?? conversationId;
    const threadTitle =
      request.subject ?? `${SURFACE_LABELS[request.surface]} · ${request.question.slice(0, 40)}`;
    await deps.methods.upsertChannelThread(request.user, key, {
      conversationId: finalConversationId,
      lastMessageId: messageId,
      title: threadTitle,
    });
    if (deps.methods.setConversationTitle && isUntitled(final)) {
      await deps.methods
        .setConversationTitle(request.user, finalConversationId, threadTitle)
        .catch((error: unknown) =>
          deps.logger.warn(`gateway: title fallback failed: ${String(error)}`),
        );
    }
    const truncated = final.responseMessage?.unfinished === true;
    if (deps.audit) {
      await deps.audit('channel.reply_sent', {
        actor: { type: 'agent', name: 'silkroad' },
        target: { type: request.surface, id: request.externalThreadId },
        metadata: { conversationId: finalConversationId, truncated, chars: answerText.length },
      });
    }
    return {
      text: request.format === 'markdown' ? answerText : toPlainText(answerText),
      conversationId: finalConversationId,
      messageId,
      truncated,
    };
  } catch (error) {
    if (controller.signal.aborted) {
      await fetchFn(`${base}${CHAT_PATH}/abort`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ conversationId, streamId: conversationId }),
      }).catch(() => undefined);
      throw new GatewayRunError(`timed out after ${deps.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
