import type { ChannelThreadLean } from '@librechat/data-schemas';
import { answerViaChat, toPlainText, GatewayPausedError, GatewayRunError } from './gateway';
import { createGatewayClient, GatewayError } from './remote';
import { isValidServiceToken, generateServiceToken } from './service';

function sse(events: Array<{ event?: string; data: object }>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const payload = events
    .map(({ event, data }) => `event: ${event ?? 'message'}\ndata: ${JSON.stringify(data)}\n\n`)
    .join('');
  const chunks = [payload.slice(0, 17), payload.slice(17)];
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

function jsonResponse(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fakeServer(options: { finalText: string; error?: boolean } = { finalText: 'ok' }) {
  const calls: Array<{ url: string; body?: string }> = [];
  const fetchFn = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: typeof init?.body === 'string' ? init.body : undefined });
    if (url.endsWith('/api/agents/chat/openAI')) {
      const body = JSON.parse(String(init?.body)) as { conversationId: string };
      return jsonResponse({
        streamId: body.conversationId,
        conversationId: body.conversationId,
        generationCreatedAt: 1234,
        status: 'started',
      });
    }
    if (url.includes('/api/agents/chat/stream/')) {
      const events = options.error
        ? [{ event: 'error', data: { error: 'boom' } }]
        : [
            { data: { message: true, text: 'partial' } },
            {
              data: {
                final: true,
                responseMessage: { messageId: 'resp-1', text: options.finalText },
                conversation: { conversationId: 'ignored' },
              },
            },
          ];
      return new Response(sse(events), { status: 200 });
    }
    if (url.endsWith('/api/agents/chat/abort')) {
      return jsonResponse({});
    }
    return jsonResponse({ error: 'unexpected' }, 500);
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

function fakeMethods(existing?: Partial<ChannelThreadLean>) {
  const store = new Map<string, ChannelThreadLean>();
  if (existing) {
    store.set('imessage:chat-1', existing as ChannelThreadLean);
  }
  return {
    store,
    paused: false,
    getChannelThread: async (_user: string, key: { surface: string; externalThreadId: string }) =>
      store.get(`${key.surface}:${key.externalThreadId}`) ?? null,
    upsertChannelThread: async (
      _user: string,
      key: { surface: string; externalThreadId: string },
      data: { conversationId: string; lastMessageId?: string; title?: string },
    ) => {
      const thread = { ...key, ...data } as unknown as ChannelThreadLean;
      store.set(`${key.surface}:${key.externalThreadId}`, thread);
      return thread;
    },
    isChannelsPaused: async () => false,
  };
}

const logger = { info: jest.fn(), warn: jest.fn() };

function deps(fetchFn: typeof fetch, methods: ReturnType<typeof fakeMethods>) {
  return {
    baseUrl: 'http://127.0.0.1:3080/',
    ownerToken: async () => 'jwt-owner',
    methods,
    spec: 'silkroad',
    endpoint: 'openAI',
    logger,
    fetchFn,
    turnBudget: 12,
  };
}

describe('answerViaChat', () => {
  it('starts a new conversation for a new thread, follows the stream, and maps the thread', async () => {
    const { fetchFn, calls } = fakeServer({
      finalText: '**Henderson** owes $12,400. See [[Henderson Invoice]].',
    });
    const methods = fakeMethods();
    const answer = await answerViaChat(deps(fetchFn, methods), {
      user: 'u1',
      surface: 'imessage',
      externalThreadId: 'chat-1',
      question: 'who owes me?',
    });
    expect(answer.text).toBe('Henderson owes $12,400. See Henderson Invoice.');
    expect(answer.messageId).toBe('resp-1');
    const start = JSON.parse(calls[0].body ?? '{}') as Record<string, unknown>;
    expect(start).toMatchObject({ spec: 'silkroad', endpoint: 'openAI', text: 'who owes me?' });
    expect(start.parentMessageId).toBe('00000000-0000-0000-0000-000000000000');
    expect(start.ephemeralAgent).toEqual({ recursion_limit: 12 });
    expect(String(start.conversationId)).toMatch(/^[0-9a-f-]{36}$/);
    expect(calls[1].url).toContain(
      `/api/agents/chat/stream/${start.conversationId}?generationCreatedAt=1234`,
    );
    expect(methods.store.get('imessage:chat-1')).toMatchObject({
      conversationId: start.conversationId,
      lastMessageId: 'resp-1',
      title: 'iMessage · who owes me?',
    });
    const authHeader = (fetchFn as unknown as jest.Mock).mock.calls[0][1].headers.Authorization;
    expect(authHeader).toBe('Bearer jwt-owner');
  });

  it('names an untitled mirrored conversation after the channel', async () => {
    const { fetchFn } = fakeServer({ finalText: 'ok' });
    const setConversationTitle = jest.fn(async () => undefined);
    const methods = { ...fakeMethods(), setConversationTitle };
    await answerViaChat(deps(fetchFn, methods), {
      user: 'u1',
      surface: 'email',
      externalThreadId: 'thread-7',
      question: 'Did the lease get signed?',
      subject: 'Lease',
    });
    expect(setConversationTitle).toHaveBeenCalledWith('u1', expect.any(String), 'Lease');
  });

  it('continues an existing thread from its last message and keeps markdown when asked', async () => {
    const { fetchFn, calls } = fakeServer({ finalText: '- one\n- two' });
    const methods = fakeMethods({ conversationId: 'conv-9', lastMessageId: 'resp-0' });
    const answer = await answerViaChat(deps(fetchFn, methods), {
      user: 'u1',
      surface: 'imessage',
      externalThreadId: 'chat-1',
      question: 'and then?',
      format: 'markdown',
    });
    const start = JSON.parse(calls[0].body ?? '{}') as Record<string, unknown>;
    expect(start).toMatchObject({ conversationId: 'conv-9', parentMessageId: 'resp-0' });
    expect(answer.text).toBe('- one\n- two');
    expect(answer.conversationId).toBe('conv-9');
  });

  it('refuses while paused and surfaces generation errors', async () => {
    const { fetchFn } = fakeServer({ finalText: 'x', error: true });
    const paused = { ...fakeMethods(), isChannelsPaused: async () => true };
    await expect(
      answerViaChat(deps(fetchFn, paused), {
        user: 'u1',
        surface: 'email',
        externalThreadId: 't',
        question: 'q',
      }),
    ).rejects.toBeInstanceOf(GatewayPausedError);
    await expect(
      answerViaChat(deps(fetchFn, fakeMethods()), {
        user: 'u1',
        surface: 'email',
        externalThreadId: 't',
        question: 'q',
      }),
    ).rejects.toBeInstanceOf(GatewayRunError);
  });

  it('aborts the generation when the timeout elapses', async () => {
    const abortCalls: string[] = [];
    const fetchFn = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/abort')) {
        abortCalls.push(url);
        return jsonResponse({});
      }
      if (url.endsWith('/openAI')) {
        return jsonResponse({ streamId: 'c', conversationId: 'c', status: 'started' });
      }
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }) as unknown as typeof fetch;
    await expect(
      answerViaChat(
        { ...deps(fetchFn, fakeMethods()), timeoutMs: 20 },
        { user: 'u1', surface: 'imessage', externalThreadId: 'x', question: 'slow' },
      ),
    ).rejects.toThrow(/timed out/);
    expect(abortCalls).toHaveLength(1);
  });
});

describe('toPlainText', () => {
  it('flattens markdown for a phone screen', () => {
    expect(
      toPlainText(
        '## Summary\n\n**Bold** and _it_ with `code` and [a link](https://x.y) and [[Note|alias]].\n\n* item\n1. first',
      ),
    ).toBe(
      'Summary\n\nBold and it with code and a link (https://x.y) and alias.\n\n- item\n1. first',
    );
  });
});

describe('gateway client', () => {
  it('posts the request with the service token and maps failure statuses', async () => {
    const fetchFn = jest.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { question: string };
      if (body.question === 'paused') {
        return jsonResponse({ error: 'paused' }, 423);
      }
      return jsonResponse({ text: 'hi', conversationId: 'c', messageId: 'm', truncated: false });
    }) as unknown as typeof fetch;
    const client = createGatewayClient({ url: 'http://api/', token: 't0k', fetchFn });
    const ok = await client.answer({
      surface: 'imessage',
      externalThreadId: 'x',
      question: 'hello',
    });
    expect(ok.text).toBe('hi');
    const [url, init] = (fetchFn as unknown as jest.Mock).mock.calls[0];
    expect(url).toBe('http://api/api/channels/answer');
    expect(init.headers.Authorization).toBe('Bearer t0k');
    await expect(
      client.answer({ surface: 'imessage', externalThreadId: 'x', question: 'paused' }),
    ).rejects.toMatchObject({ kind: 'paused', status: 423 });
    const down = createGatewayClient({
      url: 'http://api',
      token: 't',
      fetchFn: (async () => {
        throw new Error('ECONNREFUSED');
      }) as unknown as typeof fetch,
    });
    await expect(
      down.answer({ surface: 'email', externalThreadId: 'x', question: 'q' }),
    ).rejects.toBeInstanceOf(GatewayError);
  });
});

describe('service token', () => {
  it('accepts only the exact configured token, constant-time, never default-open', () => {
    const token = generateServiceToken();
    expect(token.length).toBeGreaterThan(30);
    expect(isValidServiceToken(`Bearer ${token}`, token)).toBe(true);
    expect(isValidServiceToken(`bearer ${token}`, token)).toBe(true);
    expect(isValidServiceToken(`Bearer ${token}x`, token)).toBe(false);
    expect(isValidServiceToken(undefined, token)).toBe(false);
    expect(isValidServiceToken('Bearer ', token)).toBe(false);
    expect(isValidServiceToken('Bearer anything', undefined)).toBe(false);
  });
});
