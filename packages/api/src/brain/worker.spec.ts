import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import type { BrainLogLean, BrainLogResolution } from '@librechat/data-schemas';
import type { BrainWorkerMethods } from './worker';
import type { GateChatMessage } from './gate';
import { runBrainWorkerOnce, applyBrainApproval } from './worker';
import { toBrainCandidate } from './candidate';
import { readBrainNote } from './vault';
import { createGate } from './gate';

const noopLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

/**
 * In-memory implementation of the queue contract; the real Mongo
 * implementation is covered by data-schemas' brainLog.spec.ts.
 */
function createQueue(entries: Array<Partial<BrainLogLean>>): {
  methods: BrainWorkerMethods;
  store: Array<BrainLogLean>;
} {
  const store = entries.map(
    (entry, index) =>
      ({
        _id: String(index),
        user: 'u1',
        surface: 'chat',
        direction: 'inbound',
        messageId: `m${index}`,
        status: 'pending',
        attempts: 0,
        text: '',
        ...entry,
      }) as unknown as BrainLogLean,
  );
  const methods: BrainWorkerMethods = {
    claimPendingBrainLogs: async (options) => {
      const claimable = store.filter(
        (entry) =>
          entry.status === 'pending' &&
          entry.direction === 'inbound' &&
          entry.attempts < (options?.maxAttempts ?? 3),
      );
      for (const entry of claimable) {
        entry.status = 'processing';
        entry.attempts += 1;
      }
      return claimable;
    },
    resolveBrainLog: async (id, resolution: BrainLogResolution) => {
      const entry = store.find((candidate) => String(candidate._id) === id);
      if (!entry) {
        return null;
      }
      Object.assign(entry, resolution, { processedAt: new Date() });
      return entry;
    },
    requeueStaleBrainLogs: async () => 0,
    getBrainLog: async (id) => store.find((candidate) => String(candidate._id) === id) ?? null,
  };
  return { methods, store };
}

let vaultPath: string;

beforeEach(async () => {
  vaultPath = await fs.mkdtemp(path.join(os.tmpdir(), 'brain-vault-'));
  await fs.writeFile(
    path.join(vaultPath, 'Acme.md'),
    '---\ntype: company\ntags: [client]\n---\n\nAcme is a client. See [[Acme Deal]].\n',
  );
});

afterEach(async () => {
  await fs.rm(vaultPath, { recursive: true, force: true });
});

function gateWith(responses: Record<'triage' | 'distill', object>) {
  const chat = jest.fn(async (messages: GateChatMessage[]) => {
    const isTriage = messages[0].content.includes('memory triage gate');
    return JSON.stringify(isTriage ? responses.triage : responses.distill);
  });
  return { gate: createGate({ chat }), chat };
}

describe('runBrainWorkerOnce', () => {
  it('skips ephemeral messages without calling the distiller', async () => {
    const { methods, store } = createQueue([{ text: 'ugh today is the worst!!' }]);
    const { gate, chat } = gateWith({
      triage: { verdict: 'ephemeral', related: [], reason: 'venting' },
      distill: {},
    });
    const processed = await runBrainWorkerOnce({
      methods,
      gate,
      vaultPath,
      approvalRequired: false,
      logger: noopLogger,
    });
    expect(processed).toBe(1);
    expect(store[0]).toMatchObject({ status: 'skipped', outcome: 'ephemeral' });
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it('skips facts the brain already knows', async () => {
    const { methods, store } = createQueue([{ text: 'Acme is our client' }]);
    const { gate } = gateWith({
      triage: { verdict: 'durable', related: ['Acme'], reason: 'client fact' },
      distill: { action: 'known', reason: 'already recorded' },
    });
    await runBrainWorkerOnce({
      methods,
      gate,
      vaultPath,
      approvalRequired: false,
      logger: noopLogger,
    });
    expect(store[0]).toMatchObject({ status: 'skipped', outcome: 'known' });
  });

  it('writes a new note immediately when approval is off', async () => {
    const { methods, store } = createQueue([
      { text: 'Signed a $50k deal with Acme, closing Friday' },
    ]);
    const { gate } = gateWith({
      triage: { verdict: 'durable', related: ['Acme'], reason: 'new deal' },
      distill: {
        action: 'create',
        noteId: 'Acme Deal',
        noteType: 'finance',
        noteContent: '$50k deal with [[Acme]], closing Friday.',
        reason: 'new deal entity',
      },
    });
    await runBrainWorkerOnce({
      methods,
      gate,
      vaultPath,
      approvalRequired: false,
      logger: noopLogger,
    });
    expect(store[0]).toMatchObject({ status: 'applied', outcome: 'create', noteId: 'Acme Deal' });
    const note = await readBrainNote(vaultPath, 'Acme Deal');
    expect(note?.type).toBe('finance');
    expect(note?.content).toContain('[[Acme]]');
  });

  it('classifies a distill targeting an existing note as merge', async () => {
    const { methods, store } = createQueue([{ text: 'Acme moved HQ to Austin' }]);
    const { gate } = gateWith({
      triage: { verdict: 'durable', related: ['Acme'], reason: 'update' },
      distill: {
        action: 'create',
        noteId: 'Acme',
        noteType: 'company',
        noteContent: 'Acme is a client based in Austin. See [[Acme Deal]].',
        reason: 'HQ update',
      },
    });
    await runBrainWorkerOnce({
      methods,
      gate,
      vaultPath,
      approvalRequired: false,
      logger: noopLogger,
    });
    expect(store[0]).toMatchObject({ status: 'applied', outcome: 'merge' });
    const note = await readBrainNote(vaultPath, 'Acme');
    expect(note?.content).toContain('Austin');
  });

  it('parks merge/create proposals for approval when the guardrail is on', async () => {
    const { methods, store } = createQueue([{ text: 'New hire: Dana Lee, VP Sales' }]);
    const { gate } = gateWith({
      triage: { verdict: 'durable', related: [], reason: 'new person' },
      distill: {
        action: 'create',
        noteId: 'Dana Lee',
        noteType: 'person',
        noteContent: 'VP Sales, joined recently.',
        reason: 'new person',
      },
    });
    await runBrainWorkerOnce({
      methods,
      gate,
      vaultPath,
      approvalRequired: true,
      logger: noopLogger,
    });
    expect(store[0]).toMatchObject({ status: 'awaiting_approval', outcome: 'create' });
    expect(await readBrainNote(vaultPath, 'Dana Lee')).toBeNull();

    const applied = await applyBrainApproval({ methods, vaultPath }, String(store[0]._id));
    expect(applied?.status).toBe('applied');
    expect(await readBrainNote(vaultPath, 'Dana Lee')).not.toBeNull();
  });

  it('retries gate failures until attempts run out, then parks as failed', async () => {
    const { methods, store } = createQueue([{ text: 'durable fact', attempts: 0 }]);
    const chat = jest.fn(async () => 'not json at all');
    const gate = createGate({ chat });
    const deps = { methods, gate, vaultPath, approvalRequired: false, logger: noopLogger };

    await runBrainWorkerOnce(deps);
    expect(store[0].status).toBe('pending');

    store[0].attempts = 2;
    store[0].status = 'pending';
    await runBrainWorkerOnce(deps);
    expect(store[0].status).toBe('failed');
  });
});

describe('toBrainCandidate', () => {
  it('maps user and agent messages to inbound/outbound candidates', () => {
    expect(
      toBrainCandidate({ messageId: 'm1', text: 'hello there', isCreatedByUser: true }),
    ).toMatchObject({ direction: 'inbound', text: 'hello there' });
    expect(
      toBrainCandidate({
        messageId: 'm2',
        isCreatedByUser: false,
        content: [{ type: 'text', text: 'agent reply' }],
      }),
    ).toMatchObject({ direction: 'outbound', text: 'agent reply' });
  });

  it('rejects temporary, errored, unfinished, and empty messages', () => {
    expect(toBrainCandidate({ messageId: 'm1', text: 'secret' }, true)).toBeNull();
    expect(toBrainCandidate({ messageId: 'm1', text: 'oops', error: true })).toBeNull();
    expect(toBrainCandidate({ messageId: 'm1', text: 'partial', unfinished: true })).toBeNull();
    expect(toBrainCandidate({ messageId: 'm1', text: ' ' })).toBeNull();
    expect(toBrainCandidate({ text: 'no id' })).toBeNull();
  });
});
