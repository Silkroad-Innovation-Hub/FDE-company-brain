import { promises as fs } from 'fs';
import { GatewayError } from '~/channels/remote';
import os from 'os';
import path from 'path';
import type {
  BrainLogLean,
  BrainLogAppendData,
  ChannelStateLean,
  ChannelNoticeLean,
} from '@librechat/data-schemas';
import type { GmailApi, GmailOutgoing, GmailProfile } from './client';
import type { GmailPollDeps, GmailPollState } from './poll';
import type { GmailMessage, GmailHeader } from './parse';
import { RecipientNotAllowedError, createDraftPolicy } from '~/channels/policy';
import {
  HistoryExpiredError,
  assertOwnerRecipient,
  buildRawMessage,
  createGmailClient,
} from './client';
import { ThreadMemory, initialState, isOwnerQuestion, processMail, syncOnce } from './poll';
import { htmlToText, parseGmailMessage, stripQuotedHistory } from './parse';

const OWNER = 'owner@example.com';

function b64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64url');
}

interface FixtureOptions {
  id: string;
  from: string;
  to: string;
  subject: string;
  text?: string;
  html?: string;
  labels?: string[];
  headers?: GmailHeader[];
  attachment?: string;
  threadId?: string;
  date?: number;
}

function message(options: FixtureOptions): GmailMessage {
  const headers: GmailHeader[] = [
    { name: 'From', value: options.from },
    { name: 'To', value: options.to },
    { name: 'Subject', value: options.subject },
    { name: 'Message-ID', value: `<${options.id}@mail.example.com>` },
    ...(options.headers ?? []),
  ];
  const parts = [
    ...(options.text != null
      ? [{ partId: '0', mimeType: 'text/plain', body: { data: b64(options.text) } }]
      : []),
    ...(options.html != null
      ? [{ partId: '1', mimeType: 'text/html', body: { data: b64(options.html) } }]
      : []),
    ...(options.attachment
      ? [
          {
            partId: '2',
            mimeType: 'application/pdf',
            filename: options.attachment,
            body: { attachmentId: 'att-1', size: 10 },
          },
        ]
      : []),
  ];
  return {
    id: options.id,
    threadId: options.threadId ?? `thread-${options.id}`,
    labelIds: options.labels ?? ['INBOX'],
    internalDate: String(options.date ?? 1_700_000_000_000),
    payload: { mimeType: 'multipart/mixed', headers, parts },
  };
}

describe('parseGmailMessage', () => {
  it('keeps only new content: strips quoted history and the signature', () => {
    const parsed = parseGmailMessage(
      message({
        id: 'm1',
        from: 'Dana Lee <dana@henderson.com>',
        to: `Owner <${OWNER}>`,
        subject: 'Re: Invoice 1042',
        text: 'Payment goes out Friday, $12,400.\n\n> earlier quoted line\nOn Mon, Aug 25, 2026 Owner wrote:\n> can you confirm the date?\n-- \nDana Lee\nAP Lead',
      }),
    );
    expect(parsed).toMatchObject({
      messageId: 'm1',
      fromAddress: 'dana@henderson.com',
      to: [OWNER],
      subject: 'Re: Invoice 1042',
      text: 'Payment goes out Friday, $12,400.',
      isBulk: false,
      isAgent: false,
      isSent: false,
      rfcMessageId: '<m1@mail.example.com>',
    });
  });

  it('falls back to HTML and converts it to readable text', () => {
    const parsed = parseGmailMessage(
      message({
        id: 'm2',
        from: 'vendor@example.com',
        to: OWNER,
        subject: 'Quote',
        html: '<html><head><style>p{}</style></head><body><p>Hi &amp; hello</p><ul><li>Unit price: &#36;40</li><li>Lead time: 3&nbsp;weeks</li></ul><script>x()</script></body></html>',
      }),
    );
    expect(parsed?.text).toBe('Hi & hello\n- Unit price: $40\n- Lead time: 3 weeks');
  });

  it('flags newsletters as bulk via List-Unsubscribe and category labels', () => {
    const unsubscribe = parseGmailMessage(
      message({
        id: 'm3',
        from: 'news@example.com',
        to: OWNER,
        subject: 'Weekly digest',
        text: 'This week in SaaS',
        headers: [{ name: 'List-Unsubscribe', value: '<mailto:unsub@example.com>' }],
      }),
    );
    expect(unsubscribe?.isBulk).toBe(true);
    const promo = parseGmailMessage(
      message({
        id: 'm4',
        from: 'shop@example.com',
        to: OWNER,
        subject: 'Sale',
        text: '50% off',
        labels: ['INBOX', 'CATEGORY_PROMOTIONS'],
      }),
    );
    expect(promo?.isBulk).toBe(true);
  });

  it('recognises agent-sent and owner-sent mail, and lists attachments', () => {
    const agent = parseGmailMessage(
      message({
        id: 'm5',
        from: OWNER,
        to: OWNER,
        subject: 'Re: Silkroad: cash?',
        text: 'You have $80k in the bank.',
        labels: ['SENT'],
        headers: [{ name: 'X-Silkroad-Agent', value: '1' }],
      }),
    );
    expect(agent).toMatchObject({ isAgent: true, isSent: true });
    const sent = parseGmailMessage(
      message({
        id: 'm6',
        from: OWNER,
        to: 'dana@henderson.com, cfo@henderson.com',
        subject: 'Invoice',
        text: 'Attached is the invoice.',
        labels: ['SENT'],
        attachment: 'invoice-1042.pdf',
      }),
    );
    expect(sent).toMatchObject({
      isAgent: false,
      isSent: true,
      to: ['dana@henderson.com', 'cfo@henderson.com'],
      text: 'Attached is the invoice.\n\n(attachments: invoice-1042.pdf)',
    });
  });

  it('returns null without ids', () => {
    expect(parseGmailMessage({ payload: {} })).toBeNull();
  });
});

describe('text helpers', () => {
  it('cuts forwarded header blocks', () => {
    expect(
      stripQuotedHistory(
        'FYI see below\n\nFrom: Bob\nSent: Monday\nTo: Owner\nSubject: x\n\nold body',
      ),
    ).toBe('FYI see below');
  });

  it('collapses whitespace in html', () => {
    expect(htmlToText('<div>a</div><br/><br/><br/><div>b</div>')).toBe(
      'a\n\n\nb'.replace('\n\n\n', '\n\n'),
    );
  });
});

describe('client guards', () => {
  it('refuses non-owner recipients and stamps the agent header on raw messages', () => {
    expect(() => assertOwnerRecipient(OWNER, 'Owner <OWNER@example.com>')).not.toThrow();
    expect(() => assertOwnerRecipient(OWNER, 'dana@henderson.com')).toThrow(/non-owner/);
    const raw = Buffer.from(
      buildRawMessage({
        to: OWNER,
        subject: 'Re: hi',
        text: 'body',
        inReplyTo: '<a@x>',
        references: '<z@x>',
      }),
      'base64url',
    ).toString('utf8');
    expect(raw).toContain('X-Silkroad-Agent: 1');
    expect(raw).toContain('References: <z@x> <a@x>');
    expect(raw.endsWith('\r\n\r\nbody')).toBe(true);
    const withCc = Buffer.from(
      buildRawMessage({ to: OWNER, cc: 'cc@example.com', subject: 's', text: 'b' }),
      'base64url',
    ).toString('utf8');
    expect(withCc).toContain('Cc: cc@example.com');
  });

  it('refuses to create drafts outside the allowlist before touching the API', async () => {
    const client = createGmailClient({
      clientId: 'id',
      clientSecret: 'secret',
      refreshToken: 'token',
      ownerEmail: OWNER,
      policy: createDraftPolicy({ ownerEmail: OWNER, allowedDomains: ['acme.com'] }),
    });
    await expect(
      client.createDraft({ to: 'x@evil.io', subject: 's', text: 'b' }),
    ).rejects.toBeInstanceOf(RecipientNotAllowedError);
    const unguarded = createGmailClient({
      clientId: 'id',
      clientSecret: 'secret',
      refreshToken: 'token',
      ownerEmail: OWNER,
    });
    await expect(unguarded.createDraft({ to: OWNER, subject: 's', text: 'b' })).rejects.toThrow(
      /draft policy/,
    );
  });
});

interface FakeMailbox {
  api: GmailApi;
  sent: GmailOutgoing[];
  messages: Map<string, GmailMessage>;
  historyId: string;
  expireHistory: boolean;
  history: string[];
}

function fakeMailbox(initial: GmailMessage[]): FakeMailbox {
  const box: FakeMailbox = {
    sent: [],
    messages: new Map(initial.map((m) => [m.id as string, m])),
    historyId: '100',
    expireHistory: false,
    history: [],
    api: {
      getProfile: async (): Promise<GmailProfile> => ({
        emailAddress: OWNER,
        historyId: box.historyId,
      }),
      listHistory: async (start) => {
        if (box.expireHistory) {
          throw new HistoryExpiredError(`expired ${start}`);
        }
        const ids = box.history.splice(0);
        return { messageIds: ids, historyId: box.historyId };
      },
      listRecent: async (max) => [...box.messages.keys()].slice(-max),
      listInbox: async (max) => [...box.messages.keys()].slice(-max).reverse(),
      getMessage: async (id) => {
        const found = box.messages.get(id);
        if (!found) {
          throw new Error(`no message ${id}`);
        }
        return found;
      },
      sendReply: async (reply) => {
        assertOwnerRecipient(OWNER, reply.to);
        box.sent.push(reply);
        const id = `agent-${box.sent.length}`;
        box.messages.set(
          id,
          message({
            id,
            from: OWNER,
            to: reply.to,
            subject: reply.subject,
            text: reply.text,
            labels: ['SENT'],
            headers: [{ name: 'X-Silkroad-Agent', value: '1' }],
            threadId: reply.threadId,
          }),
        );
        box.history.push(id);
        box.historyId = String(Number(box.historyId) + 1);
        return id;
      },
      createDraft: async () => 'draft-1',
      sendDraft: async () => 'sent-draft-1',
      deleteDraft: async () => undefined,
      getDraftRecipients: async () => ({ to: [], cc: [] }),
    },
  };
  return box;
}

function fakeMethods() {
  const log = new Map<string, BrainLogLean>();
  const notices: ChannelNoticeLean[] = [];
  let paused = false;
  const appendBrainLog = jest.fn(async (user: string, data: BrainLogAppendData) => {
    const existing = log.get(data.messageId);
    if (existing) {
      const updated = { ...existing, updatedAt: new Date(Date.now() + 10) };
      log.set(data.messageId, updated);
      return updated;
    }
    const now = new Date();
    const { resolution, ...rest } = data;
    const entry = {
      _id: data.messageId,
      user,
      ...rest,
      status: 'pending',
      attempts: 0,
      ...(resolution ?? {}),
      createdAt: now,
      updatedAt: now,
    } as unknown as BrainLogLean;
    log.set(data.messageId, entry);
    return entry;
  });
  return {
    log,
    methods: {
      appendBrainLog,
      isChannelsPaused: async () => paused,
      setChannelsPaused: async (_user: string, value: boolean) => {
        paused = value;
        return { paused: value } as unknown as ChannelStateLean;
      },
      getTodos: async () => [],
      claimChannelNotices: async () => {
        const pending = notices.filter((n) => n.status === 'pending');
        for (const notice of pending) {
          notice.status = 'delivering';
          notice.attempts += 1;
        }
        return pending;
      },
      resolveChannelNotice: async (id: string, outcome: { delivered: boolean; via: string }) => {
        const notice = notices.find((n) => String(n._id) === id) ?? null;
        if (notice) {
          notice.status = outcome.delivered ? 'delivered' : 'pending';
          notice.deliveredVia = outcome.delivered ? outcome.via : undefined;
        }
        return notice;
      },
    },
    notices,
    addNotice: (text: string) => {
      const notice = {
        _id: `n${notices.length + 1}`,
        user: 'u1',
        kind: 'budget',
        text,
        status: 'pending',
        attempts: 0,
      } as unknown as ChannelNoticeLean;
      notices.push(notice);
      return notice;
    },
  };
}

function memoryStore(initial: GmailPollState | null = null) {
  let saved = initial;
  return {
    load: () => saved,
    save: (state: GmailPollState) => {
      saved = state;
    },
    get: () => saved,
  };
}

describe('gmail poller', () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = await fs.mkdtemp(path.join(os.tmpdir(), 'gmail-vault-'));
    await fs.writeFile(
      path.join(vaultPath, 'Henderson.md'),
      '---\ntype: company\ntags: [client]\n---\n\nHenderson owes **$12,400** on invoice 1042.\n',
    );
  });

  afterEach(async () => {
    await fs.rm(vaultPath, { recursive: true, force: true });
  });

  function deps(
    box: FakeMailbox,
    store = memoryStore(),
  ): { deps: GmailPollDeps; fake: ReturnType<typeof fakeMethods>; chat: jest.Mock } {
    const fake = fakeMethods();
    const chat = jest.fn(async () => 'Henderson owes $12,400 on invoice 1042.');
    return {
      fake,
      chat,
      deps: {
        api: box.api,
        methods: fake.methods,
        chat,
        model: 'test-model',
        vaultPath,
        owner: { user: 'u1', email: OWNER },
        logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
        store,
      },
    };
  }

  it('logs third-party mail inbound with provenance and never answers it', async () => {
    const box = fakeMailbox([]);
    const { deps: d, fake, chat } = deps(box);
    const mail = parseGmailMessage(
      message({
        id: 't1',
        from: 'Dana <dana@henderson.com>',
        to: OWNER,
        subject: 'Payment',
        text: 'Paying Friday',
      }),
    );
    expect(await processMail(d, mail!, new ThreadMemory())).toBe('logged');
    expect(fake.log.get('gmail-t1')).toMatchObject({
      surface: 'email',
      direction: 'inbound',
      sender: 'Dana <dana@henderson.com>',
      subject: 'Payment',
      conversationId: 'thread-t1',
      status: 'pending',
    });
    expect(chat).not.toHaveBeenCalled();
    expect(box.sent).toHaveLength(0);
  });

  it('logs bulk mail pre-resolved and never triages it', async () => {
    const box = fakeMailbox([]);
    const { deps: d, fake } = deps(box);
    const mail = parseGmailMessage(
      message({
        id: 'b1',
        from: 'news@example.com',
        to: OWNER,
        subject: 'Digest',
        text: 'news',
        headers: [{ name: 'List-Unsubscribe', value: '<mailto:x>' }],
      }),
    );
    expect(await processMail(d, mail!, new ThreadMemory())).toBe('logged');
    expect(fake.log.get('gmail-b1')).toMatchObject({ status: 'skipped', outcome: 'bulk' });
  });

  it('answers a self-addressed owner email in-thread, to the owner only, and does not re-answer its own reply', async () => {
    const q = message({
      id: 'q1',
      from: `Owner <${OWNER}>`,
      to: OWNER,
      subject: 'Henderson?',
      text: 'How much does Henderson owe?',
    });
    const box = fakeMailbox([q]);
    box.history.push('q1');
    const { deps: d, fake, chat } = deps(box);
    const memory = new ThreadMemory();
    const next = await syncOnce(d, { historyId: '100' }, memory);
    expect(box.sent).toHaveLength(1);
    expect(box.sent[0]).toMatchObject({
      to: OWNER,
      subject: 'Re: Henderson?',
      threadId: 'thread-q1',
      inReplyTo: '<q1@mail.example.com>',
      text: 'Henderson owes $12,400 on invoice 1042.',
    });
    expect(chat).toHaveBeenCalledTimes(1);
    expect(chat.mock.calls[0][0][1].content).toContain('$12,400');
    expect(next.historyId).toBe('100');

    const after = await syncOnce(d, next, memory);
    expect(after.historyId).toBe('101');
    expect(fake.log.get('gmail-agent-1')).toMatchObject({ direction: 'outbound' });
    expect(chat).toHaveBeenCalledTimes(1);
    expect(box.sent).toHaveLength(1);
    expect(memory.history('thread-q1')).toHaveLength(2);
  });

  it('answers through the gateway when one is configured and stays silent when it is paused', async () => {
    const q = message({
      id: 'g1',
      from: `Owner <${OWNER}>`,
      to: OWNER,
      subject: 'Henderson?',
      text: 'How much does Henderson owe?',
    });
    const box = fakeMailbox([q]);
    const { deps: d, chat } = deps(box);
    const gateway = {
      answer: jest.fn(async () => ({
        text: 'Gateway says $12,400.',
        conversationId: 'c1',
        messageId: 'm1',
        truncated: false,
      })),
    };
    const mail = parseGmailMessage(q)!;
    expect(await processMail({ ...d, gateway }, mail, new ThreadMemory())).toBe('answered');
    expect(gateway.answer).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'email',
        externalThreadId: 'thread-g1',
        question: 'How much does Henderson owe?',
        subject: 'Henderson?',
        format: 'plain',
      }),
    );
    expect(box.sent[0].text).toBe('Gateway says $12,400.');
    expect(chat).not.toHaveBeenCalled();

    const paused = {
      answer: jest.fn(async () => {
        throw new GatewayError('paused', 'paused', 423);
      }),
    };
    const box2 = fakeMailbox([q]);
    const { deps: d2 } = deps(box2);
    expect(await processMail({ ...d2, gateway: paused }, mail, new ThreadMemory())).toBe('paused');
    expect(box2.sent).toHaveLength(0);
  });

  it('treats a "Silkroad:" subject as a question even with other recipients, but not plain outbound mail', () => {
    const tagged = parseGmailMessage(
      message({
        id: 's1',
        from: OWNER,
        to: 'dana@henderson.com',
        subject: 'Silkroad: what do they owe?',
        text: 'x',
      }),
    );
    expect(isOwnerQuestion(tagged!, OWNER)).toBe(true);
    const outbound = parseGmailMessage(
      message({
        id: 's2',
        from: OWNER,
        to: 'dana@henderson.com',
        subject: 'Invoice',
        text: 'x',
        labels: ['SENT'],
      }),
    );
    expect(isOwnerQuestion(outbound!, OWNER)).toBe(false);
    const third = parseGmailMessage(
      message({
        id: 's3',
        from: 'dana@henderson.com',
        to: OWNER,
        subject: 'Silkroad: ignore this',
        text: 'x',
      }),
    );
    expect(isOwnerQuestion(third!, OWNER)).toBe(false);
  });

  it('flips the kill switch on "pause everything" and stays silent until resumed', async () => {
    const box = fakeMailbox([]);
    const { deps: d, chat } = deps(box);
    const memory = new ThreadMemory();
    const pause = parseGmailMessage(
      message({ id: 'p1', from: OWNER, to: OWNER, subject: 'stop', text: 'Pause everything' }),
    );
    expect(await processMail(d, pause!, memory)).toBe('acknowledged');
    expect(box.sent[0].text).toMatch(/^Paused/);

    const q = parseGmailMessage(
      message({ id: 'p2', from: OWNER, to: OWNER, subject: 'q', text: 'what does Henderson owe?' }),
    );
    expect(await processMail(d, q!, memory)).toBe('paused');
    expect(chat).not.toHaveBeenCalled();

    const resume = parseGmailMessage(
      message({ id: 'p3', from: OWNER, to: OWNER, subject: 'go', text: 'resume' }),
    );
    expect(await processMail(d, resume!, memory)).toBe('acknowledged');
    const q2 = parseGmailMessage(
      message({ id: 'p4', from: OWNER, to: OWNER, subject: 'q', text: 'what does Henderson owe?' }),
    );
    expect(await processMail(d, q2!, memory)).toBe('answered');
    expect(box.sent).toHaveLength(3);
  });

  it('does not re-answer a duplicate id', async () => {
    const box = fakeMailbox([]);
    const { deps: d, chat } = deps(box);
    const q = parseGmailMessage(
      message({ id: 'd1', from: OWNER, to: OWNER, subject: 'q', text: 'what does Henderson owe?' }),
    );
    expect(await processMail(d, q!, new ThreadMemory())).toBe('answered');
    expect(await processMail(d, q!, new ThreadMemory())).toBe('duplicate');
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it('falls back to a recent scan and resets the cursor when history has expired', async () => {
    const box = fakeMailbox([
      message({
        id: 'r1',
        from: 'dana@henderson.com',
        to: OWNER,
        subject: 'old',
        text: 'hello there',
      }),
    ]);
    box.expireHistory = true;
    box.historyId = '500';
    const store = memoryStore({ historyId: '1' });
    const { deps: d, fake } = deps(box, store);
    const next = await syncOnce(d, { historyId: '1' }, new ThreadMemory());
    expect(next).toEqual({ historyId: '500' });
    expect(store.get()).toEqual({ historyId: '500' });
    expect(fake.log.has('gmail-r1')).toBe(true);
    expect(d.logger.warn).toHaveBeenCalled();
  });

  it('emails pending notices to the owner once and retries failed sends', async () => {
    const box = fakeMailbox([]);
    const { deps: d, fake } = deps(box);
    fake.addNotice('Silkroad spend this month is $131 — 2.6× the expected $50.');
    await syncOnce(d, { historyId: '100' }, new ThreadMemory());
    expect(box.sent).toHaveLength(1);
    expect(box.sent[0]).toMatchObject({ to: OWNER, subject: 'Silkroad notice' });
    expect(box.sent[0].text).toContain('$131');
    expect(fake.notices[0]).toMatchObject({ status: 'delivered', deliveredVia: 'email' });

    await syncOnce(d, { historyId: box.historyId }, new ThreadMemory());
    expect(box.sent).toHaveLength(1);

    const failing = fake.addNotice('second');
    const original = box.api.sendReply;
    box.api.sendReply = async () => {
      throw new Error('smtp down');
    };
    await syncOnce(d, { historyId: box.historyId }, new ThreadMemory());
    expect(failing.status).toBe('pending');
    expect(d.logger.error).toHaveBeenCalled();
    box.api.sendReply = original;
    await syncOnce(d, { historyId: box.historyId }, new ThreadMemory());
    expect(failing.status).toBe('delivered');
    expect(box.sent).toHaveLength(2);
  });

  it('starts at the current history on first run and backfills when asked', async () => {
    const box = fakeMailbox([
      message({ id: 'old1', from: 'a@example.com', to: OWNER, subject: 'a', text: 'first' }),
      message({ id: 'old2', from: 'b@example.com', to: OWNER, subject: 'b', text: 'second' }),
    ]);
    const store = memoryStore();
    const { deps: d, fake } = deps(box, store);
    const state = await initialState({ ...d, backfill: 1 }, new ThreadMemory());
    expect(state).toEqual({ historyId: '100' });
    expect(store.get()).toEqual({ historyId: '100' });
    expect(fake.log.has('gmail-old2')).toBe(true);
    expect(fake.log.has('gmail-old1')).toBe(false);
  });
});
