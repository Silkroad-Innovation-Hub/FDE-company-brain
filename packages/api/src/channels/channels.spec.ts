import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import type { BrainLogLean, BrainLogAppendData, TodoLean } from '@librechat/data-schemas';
import type { BrainRetriever } from '~/brain/retrieval/types';
import type { BrainChatMessage } from '~/brain/openai';
import { handlePauseCommand, parsePauseCommand, PAUSE_ACK } from './pause';
import { answerQuestion, relevantNotes } from './answer';
import { ingestChannelMessage } from './ingest';

function fakeLog() {
  const store = new Map<string, BrainLogLean>();
  const appendBrainLog = jest.fn(async (user: string, data: BrainLogAppendData) => {
    const existing = store.get(data.messageId);
    if (existing) {
      const updated = { ...existing, text: data.text, updatedAt: new Date(Date.now() + 5) };
      store.set(data.messageId, updated);
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
    store.set(data.messageId, entry);
    return entry;
  });
  return { appendBrainLog, store };
}

describe('ingestChannelMessage', () => {
  it('appends once and reports later appends of the same id as not fresh', async () => {
    const methods = fakeLog();
    const message = {
      surface: 'imessage' as const,
      direction: 'inbound' as const,
      messageId: 'imessage-1',
      conversationId: 'chat-1',
      text: 'Signed with Acme today',
      sender: '+15551234567',
    };
    const first = await ingestChannelMessage(methods, 'u1', message);
    expect(first.fresh).toBe(true);
    expect(first.entry).toMatchObject({ surface: 'imessage', sender: '+15551234567' });
    const second = await ingestChannelMessage(methods, 'u1', message);
    expect(second.fresh).toBe(false);
  });

  it('logs bulk mail pre-resolved and drops empty text without touching the log', async () => {
    const methods = fakeLog();
    const bulk = await ingestChannelMessage(methods, 'u1', {
      surface: 'email',
      direction: 'inbound',
      messageId: 'gmail-9',
      text: 'Our weekly digest',
      sender: 'news@example.com',
      subject: 'Digest',
      bulk: true,
    });
    expect(bulk.entry).toMatchObject({ status: 'skipped', outcome: 'bulk' });
    expect(methods.appendBrainLog.mock.calls[0][1].resolution).toMatchObject({ outcome: 'bulk' });

    const empty = await ingestChannelMessage(methods, 'u1', {
      surface: 'email',
      direction: 'inbound',
      messageId: 'gmail-10',
      text: ' ',
    });
    expect(empty).toEqual({ entry: null, fresh: false });
    expect(methods.appendBrainLog).toHaveBeenCalledTimes(1);
  });
});

describe('pause command', () => {
  it('recognises only the exact kill-switch phrases', () => {
    expect(parsePauseCommand('Pause everything!')).toBe('pause');
    expect(parsePauseCommand('Silkroad: pause')).toBe('pause');
    expect(parsePauseCommand('resume')).toBe('resume');
    expect(parsePauseCommand('please pause the Acme deal')).toBeNull();
    expect(parsePauseCommand('resume talks with Dana')).toBeNull();
  });

  it('flips the state and returns an acknowledgement', async () => {
    const setChannelsPaused = jest.fn(async () => ({}) as never);
    const ack = await handlePauseCommand({ setChannelsPaused }, 'u1', 'pause everything', 'email');
    expect(ack).toBe(PAUSE_ACK);
    expect(setChannelsPaused).toHaveBeenCalledWith('u1', true, 'email');
    expect(await handlePauseCommand({ setChannelsPaused }, 'u1', 'hello', 'email')).toBeNull();
  });

  it('audits pause and resume when a recorder is available, and survives a failing one', async () => {
    const setChannelsPaused = jest.fn(async () => ({}) as never);
    const recordAuditEntry = jest.fn(async () => ({}) as never);
    await handlePauseCommand({ setChannelsPaused, recordAuditEntry }, 'u1', 'pause', 'imessage');
    await handlePauseCommand({ setChannelsPaused, recordAuditEntry }, 'u1', 'resume', 'imessage');
    expect(recordAuditEntry.mock.calls.map((call) => (call as unknown[])[0])).toEqual([
      expect.objectContaining({
        action: 'channel.paused',
        severity: 'warning',
        actor: { type: 'user', id: 'u1', name: 'owner' },
        target: { type: 'channels', id: 'u1' },
        metadata: { via: 'imessage' },
      }),
      expect.objectContaining({ action: 'channel.resumed', severity: 'info' }),
    ]);
    const broken = jest.fn(async () => {
      throw new Error('audit down');
    });
    await expect(
      handlePauseCommand({ setChannelsPaused, recordAuditEntry: broken }, 'u1', 'pause', 'email'),
    ).resolves.toBe(PAUSE_ACK);
  });
});

describe('answerQuestion', () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = await fs.mkdtemp(path.join(os.tmpdir(), 'channels-vault-'));
    await fs.writeFile(
      path.join(vaultPath, 'Henderson Invoice.md'),
      '---\ntype: finance\ntags: [ar]\n---\n\n**$12,400 overdue** since Aug 1. Contact [[Dana Lee]].\n',
    );
    await fs.writeFile(
      path.join(vaultPath, 'Dana Lee.md'),
      '---\ntype: person\ntags: [contact]\n---\n\nAP lead at Henderson.\n',
    );
    await fs.writeFile(
      path.join(vaultPath, 'Office Lease.md'),
      '---\ntype: facility\ntags: [ops]\n---\n\nLease renews in March.\n',
    );
  });

  afterEach(async () => {
    await fs.rm(vaultPath, { recursive: true, force: true });
  });

  it('ranks notes lexically with a title bonus', async () => {
    const notes = await relevantNotes(vaultPath, 'what is going on with the henderson invoice?');
    expect(notes.map((note) => note.id)[0]).toBe('Henderson Invoice');
    expect(notes.some((note) => note.id === 'Office Lease')).toBe(false);
  });

  it('grounds the prompt in open to-dos and matched notes', async () => {
    const chat = jest.fn(async (messages: BrainChatMessage[]) => {
      expect(messages[0].content).toContain('over iMessage');
      expect(messages[1].content).toContain('1. Chase Henderson');
      expect(messages[1].content).not.toContain('Done already');
      expect(messages[1].content).toContain('$12,400 overdue');
      expect(messages[1].content).toContain('Owner: earlier question');
      return '  Henderson owes $12,400 since Aug 1; Dana Lee is the AP contact.  ';
    });
    const todos = [
      { text: 'Chase Henderson', done: false, position: 1 },
      { text: 'Done already', done: true, position: 0 },
    ] as unknown as TodoLean[];
    const answer = await answerQuestion(
      { chat, model: 'test-model', vaultPath, methods: { getTodos: async () => todos } },
      {
        user: 'u1',
        surface: 'iMessage',
        question: 'who owes me on the henderson invoice',
        history: [{ fromOwner: true, text: 'earlier question' }],
      },
    );
    expect(answer).toBe('Henderson owes $12,400 since Aug 1; Dana Lee is the AP contact.');
    expect(chat).toHaveBeenCalledWith(expect.any(Array), 'test-model');
  });

  it('prefers the retriever and renders raw-log hits with provenance', async () => {
    const search = jest.fn(async () => [
      {
        kind: 'log' as const,
        refId: 'log-1',
        title: 'imessage from +15551234567',
        text: 'Vannevar pilot signed, 250k',
        score: 0.9,
        surface: 'imessage',
        sender: '+15551234567',
        sourceAt: new Date('2026-08-28T12:00:00Z'),
      },
      {
        kind: 'note' as const,
        refId: 'Henderson Invoice',
        title: 'Henderson Invoice',
        text: '# Henderson Invoice\n$12,400',
        score: 0.6,
      },
    ]);
    const retriever = { search } as unknown as BrainRetriever;
    const chat = jest.fn(async (messages: BrainChatMessage[]) => {
      expect(messages[1].content).toContain('--- iMessage from +15551234567, Aug 28 ---');
      expect(messages[1].content).toContain('--- Henderson Invoice ---');
      return 'ok';
    });
    await answerQuestion(
      { chat, model: 'm', vaultPath, retriever, methods: { getTodos: async () => [] } },
      { user: 'u1', surface: 'iMessage', question: 'vannevar?' },
    );
    expect(search).toHaveBeenCalledWith('u1', 'vannevar?', { k: 5 });
    expect(chat).toHaveBeenCalledTimes(1);
  });
});
