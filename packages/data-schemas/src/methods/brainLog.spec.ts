import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { IBrainLogDocument } from '~/schema/brainLog';
import { createBrainLogMethods, type BrainLogMethods } from './brainLog';
import { createModels } from '~/models';

jest.mock('~/config/winston', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

let mongoServer: InstanceType<typeof MongoMemoryServer>;
let BrainLog: mongoose.Model<IBrainLogDocument>;
let methods: BrainLogMethods;

const userId = new mongoose.Types.ObjectId().toString();

function inbound(messageId: string, text: string) {
  return {
    surface: 'chat' as const,
    direction: 'inbound' as const,
    conversationId: 'c9f7f9a0-0000-4000-8000-000000000000',
    messageId,
    text,
  };
}

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  createModels(mongoose);
  BrainLog = mongoose.models.BrainLog as mongoose.Model<IBrainLogDocument>;
  methods = createBrainLogMethods(mongoose);
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await BrainLog.deleteMany({});
});

describe('appendBrainLog', () => {
  it('creates a pending entry for a new message', async () => {
    const entry = await methods.appendBrainLog(userId, inbound('m1', 'New deal with Acme'));
    expect(entry).toMatchObject({
      user: userId,
      status: 'pending',
      direction: 'inbound',
      text: 'New deal with Acme',
      attempts: 0,
    });
  });

  it('upserts by messageId without duplicating or resetting status', async () => {
    await methods.appendBrainLog(userId, inbound('m1', 'partial'));
    await BrainLog.updateOne({ messageId: 'm1' }, { $set: { status: 'applied' } });
    const updated = await methods.appendBrainLog(userId, inbound('m1', 'full final text'));
    expect(updated?.text).toBe('full final text');
    expect(updated?.status).toBe('applied');
    expect(await BrainLog.countDocuments({ messageId: 'm1' })).toBe(1);
  });
});

describe('appendBrainLog — channel provenance', () => {
  it('stores sender/subject and inserts pre-resolved bulk entries outside the queue', async () => {
    const entry = await methods.appendBrainLog(userId, {
      surface: 'email',
      direction: 'inbound',
      messageId: 'gmail-1',
      conversationId: 'thread-1',
      text: 'Weekly newsletter',
      sender: 'news@example.com',
      subject: 'This week',
      resolution: { status: 'skipped', outcome: 'bulk', reason: 'Bulk mail' },
    });
    expect(entry).toMatchObject({
      surface: 'email',
      sender: 'news@example.com',
      subject: 'This week',
      status: 'skipped',
      outcome: 'bulk',
    });
    expect(entry?.processedAt).toBeInstanceOf(Date);
    expect(await methods.claimPendingBrainLogs({ quietMs: 0 })).toHaveLength(0);
  });

  it('records flagged outcomes and to-do items on resolution', async () => {
    const entry = await methods.appendBrainLog(userId, inbound('m1', 'do X by Friday'));
    const resolved = await methods.resolveBrainLog(String(entry?._id), {
      status: 'awaiting_approval',
      outcome: 'ephemeral',
      todoItems: ['Do X by Friday'],
    });
    expect(resolved?.todoItems).toEqual(['Do X by Friday']);
    const flagged = await methods.resolveBrainLog(String(entry?._id), {
      status: 'skipped',
      outcome: 'flagged',
    });
    expect(flagged?.outcome).toBe('flagged');
  });
});

describe('claimPendingBrainLogs', () => {
  it('claims only inbound pending entries older than the quiet window', async () => {
    await methods.appendBrainLog(userId, inbound('m1', 'durable fact'));
    await methods.appendBrainLog(userId, {
      ...inbound('m2', 'agent reply'),
      direction: 'outbound',
    });

    const quiet = await methods.claimPendingBrainLogs({ quietMs: 60_000 });
    expect(quiet).toHaveLength(0);

    const claimed = await methods.claimPendingBrainLogs({ quietMs: 0 });
    expect(claimed).toHaveLength(1);
    expect(claimed[0].messageId).toBe('m1');
    expect(claimed[0].status).toBe('processing');
    expect(claimed[0].attempts).toBe(1);
  });

  it('never hands the same entry to two claimants', async () => {
    await methods.appendBrainLog(userId, inbound('m1', 'fact one'));
    await methods.appendBrainLog(userId, inbound('m2', 'fact two'));
    const [first, second] = await Promise.all([
      methods.claimPendingBrainLogs({ quietMs: 0 }),
      methods.claimPendingBrainLogs({ quietMs: 0 }),
    ]);
    const ids = [...first, ...second].map((entry) => entry.messageId).sort();
    expect(ids).toEqual(['m1', 'm2']);
  });

  it('stops claiming after maxAttempts', async () => {
    await methods.appendBrainLog(userId, inbound('m1', 'flaky fact'));
    await BrainLog.updateOne({ messageId: 'm1' }, { $set: { attempts: 3 } });
    const claimed = await methods.claimPendingBrainLogs({ quietMs: 0, maxAttempts: 3 });
    expect(claimed).toHaveLength(0);
  });
});

describe('resolveBrainLog', () => {
  it('records outcome, note proposal, and processedAt', async () => {
    const entry = await methods.appendBrainLog(userId, inbound('m1', 'New deal with Acme'));
    const resolved = await methods.resolveBrainLog(String(entry?._id), {
      status: 'awaiting_approval',
      outcome: 'create',
      noteId: 'Acme Deal',
      noteType: 'finance',
      noteContent: 'Deal facts',
      reason: 'new entity',
    });
    expect(resolved).toMatchObject({
      status: 'awaiting_approval',
      outcome: 'create',
      noteId: 'Acme Deal',
    });
    expect(resolved?.processedAt).toBeInstanceOf(Date);
  });
});

describe('requeueStaleBrainLogs', () => {
  it('returns stuck processing entries to pending', async () => {
    await methods.appendBrainLog(userId, inbound('m1', 'fact'));
    await methods.claimPendingBrainLogs({ quietMs: 0 });
    const requeued = await methods.requeueStaleBrainLogs(0);
    expect(requeued).toBe(1);
    const entry = await BrainLog.findOne({ messageId: 'm1' }).lean();
    expect(entry?.status).toBe('pending');
  });
});

describe('listBrainLogs and countBrainLogsByStatus', () => {
  it('filters by user and status and aggregates counts', async () => {
    const otherUser = new mongoose.Types.ObjectId().toString();
    const entry = await methods.appendBrainLog(userId, inbound('m1', 'fact'));
    await methods.appendBrainLog(otherUser, inbound('m2', 'other user fact'));
    await methods.resolveBrainLog(String(entry?._id), { status: 'awaiting_approval' });

    const approvals = await methods.listBrainLogs({ user: userId, status: 'awaiting_approval' });
    expect(approvals).toHaveLength(1);
    expect(approvals[0].messageId).toBe('m1');

    const counts = await methods.countBrainLogsByStatus();
    expect(counts).toEqual({ awaiting_approval: 1, pending: 1 });
  });
});
