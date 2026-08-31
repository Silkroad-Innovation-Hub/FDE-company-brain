import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createModels, createMethods } from '@librechat/data-schemas';
import type { BrainLogLean } from '@librechat/data-schemas';
import type { BrainRetriever } from './types';
import { createBrainRetriever } from './index';
import { fakeEmbed } from './__tests__/helpers/embed';

let mongoServer: InstanceType<typeof MongoMemoryServer>;
let methods: ReturnType<typeof createMethods>;
let retriever: BrainRetriever;
let vaultPath: string;
let embedCalls: number;

const user = new mongoose.Types.ObjectId().toString();
const logger = { info: jest.fn(), warn: jest.fn() };

async function writeNote(id: string, body: string): Promise<void> {
  await fs.writeFile(
    path.join(vaultPath, `${id}.md`),
    `---\ntype: note\ntags: []\n---\n\n${body}\n`,
  );
}

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  createModels(mongoose);
  methods = createMethods(mongoose);
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await Promise.all([
    mongoose.models.BrainVector.deleteMany({}),
    mongoose.models.BrainLog.deleteMany({}),
  ]);
  vaultPath = await fs.mkdtemp(path.join(os.tmpdir(), 'retrieval-vault-'));
  await writeNote('Henderson Invoice', '**$12,400 overdue** since Aug 1. Contact [[Dana Lee]].');
  await writeNote('Dana Lee', 'AP lead at Henderson, handles invoice payments.');
  await writeNote('Office Lease', 'Lease renews in March; landlord is Prime Realty.');
  embedCalls = 0;
  retriever = createBrainRetriever({
    methods,
    embed: async (texts) => {
      embedCalls += 1;
      return fakeEmbed(texts);
    },
    logger,
    options: { logDays: 90, minScore: 0.1 },
  });
});

afterEach(async () => {
  await fs.rm(vaultPath, { recursive: true, force: true });
});

describe('createBrainRetriever', () => {
  it('indexes the vault and returns the best note for a question', async () => {
    const synced = await retriever.syncVault(user, vaultPath);
    expect(synced).toEqual({ indexed: 3, unchanged: 0, removed: 0 });
    const hits = await retriever.search(user, 'how much does henderson owe on the invoice?');
    expect(hits[0]).toMatchObject({ kind: 'note', refId: 'Henderson Invoice' });
    const lease = hits.find((hit) => hit.refId === 'Office Lease');
    expect(lease?.score ?? 0).toBeLessThan(hits[0].score);
  });

  it('skips unchanged notes on re-sync and prunes stale chunks after an edit', async () => {
    await retriever.syncVault(user, vaultPath);
    const before = embedCalls;
    expect(await retriever.syncVault(user, vaultPath)).toEqual({
      indexed: 0,
      unchanged: 3,
      removed: 0,
    });
    expect(embedCalls).toBe(before);

    const long = `Intro.\n${'## Section A\n' + 'alpha '.repeat(1500)}\n${'## Section B\n' + 'beta '.repeat(1500)}`;
    await writeNote('Office Lease', long);
    const grown = await retriever.syncVault(user, vaultPath);
    expect(grown.indexed).toBeGreaterThanOrEqual(2);
    await writeNote('Office Lease', 'Short again.');
    const shrunk = await retriever.syncVault(user, vaultPath);
    expect(shrunk.indexed).toBe(1);
    expect(shrunk.removed).toBeGreaterThanOrEqual(1);
    expect(await methods.listBrainVectorHashes(user, 'note', 'Office Lease')).toHaveLength(1);
  });

  it('embeds new raw-log entries lazily at search time and surfaces them with provenance', async () => {
    await retriever.syncVault(user, vaultPath);
    await methods.appendBrainLog(user, {
      surface: 'imessage',
      direction: 'inbound',
      messageId: 'im-1',
      text: 'Signed the Vannevar pilot today, 250k over six months',
      sender: '+15551234567',
    });
    await methods.appendBrainLog(user, {
      surface: 'email',
      direction: 'inbound',
      messageId: 'gm-bulk',
      text: 'Weekly digest about Vannevar and everything else',
      resolution: { status: 'skipped', outcome: 'bulk' },
    });
    await methods.appendBrainLog(user, {
      surface: 'chat',
      direction: 'outbound',
      messageId: 'agent-1',
      text: 'Vannevar pilot noted.',
    });
    const hits = await retriever.search(user, 'what did we agree with vannevar?', { k: 3 });
    expect(hits[0]).toMatchObject({ kind: 'log', surface: 'imessage', sender: '+15551234567' });
    expect(hits.some((hit) => hit.text.includes('Weekly digest'))).toBe(false);
    const embedded = await mongoose.models.BrainLog.countDocuments({
      embeddedAt: { $exists: true },
    });
    expect(embedded).toBe(1);
    expect(await retriever.syncLog(user)).toBe(0);
  });

  it('respects the log window and source filters', async () => {
    await retriever.syncVault(user, vaultPath);
    await methods.appendBrainLog(user, {
      surface: 'imessage',
      direction: 'inbound',
      messageId: 'im-old',
      text: 'henderson invoice chased last year',
    });
    await mongoose.models.BrainLog.updateOne(
      { messageId: 'im-old' },
      { $set: { createdAt: new Date(Date.now() - 120 * 86_400_000) } },
    );
    await retriever.indexLogEntries(
      user,
      await mongoose.models.BrainLog.find({ messageId: 'im-old' }).lean<BrainLogLean[]>(),
    );
    const notesOnly = await retriever.search(user, 'henderson invoice', { sources: ['note'] });
    expect(notesOnly.every((hit) => hit.kind === 'note')).toBe(true);
    const recent = await retriever.search(user, 'henderson invoice', { sinceDays: 30 });
    expect(recent.some((hit) => hit.refId.endsWith('im-old'))).toBe(false);
    const wide = await retriever.search(user, 'henderson invoice chased', { sinceDays: 365 });
    expect(wide.some((hit) => hit.kind === 'log')).toBe(true);
  });

  it('removes a note from the index', async () => {
    await retriever.syncVault(user, vaultPath);
    expect(await retriever.removeNote(user, 'Office Lease')).toBe(1);
    const hits = await retriever.search(user, 'when does the office lease renew?');
    expect(hits.some((hit) => hit.refId === 'Office Lease')).toBe(false);
  });
});
