import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createGuardrailStateMethods, type GuardrailStateMethods } from './guardrailState';
import { createChannelThreadMethods, type ChannelThreadMethods } from './channelThread';
import { createChannelNoticeMethods, type ChannelNoticeMethods } from './channelNotice';
import { createModels } from '~/models';

jest.mock('~/config/winston', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

let mongoServer: InstanceType<typeof MongoMemoryServer>;
let notices: ChannelNoticeMethods;
let threads: ChannelThreadMethods;
let guardrails: GuardrailStateMethods;

const userId = new mongoose.Types.ObjectId().toString();

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  createModels(mongoose);
  notices = createChannelNoticeMethods(mongoose);
  threads = createChannelThreadMethods(mongoose);
  guardrails = createGuardrailStateMethods(mongoose);
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('channel notices', () => {
  it('claims pending notices once, redelivers failures, and marks delivery', async () => {
    const created = await notices.createChannelNotice(userId, 'budget', 'You are at 2× budget.');
    expect(created.status).toBe('pending');

    const [first, second] = await Promise.all([
      notices.claimChannelNotices(userId),
      notices.claimChannelNotices(userId),
    ]);
    expect(first.length + second.length).toBe(1);

    const failed = await notices.resolveChannelNotice(String(created._id), {
      delivered: false,
      via: 'imessage',
    });
    expect(failed?.status).toBe('pending');

    const [again] = await notices.claimChannelNotices(userId);
    expect(again.attempts).toBe(2);
    const done = await notices.resolveChannelNotice(String(created._id), {
      delivered: true,
      via: 'imessage',
    });
    expect(done).toMatchObject({ status: 'delivered', deliveredVia: 'imessage' });
    expect(await notices.claimChannelNotices(userId)).toHaveLength(0);
  });
});

describe('channel threads', () => {
  it('maps an external thread to one conversation and tracks the last message', async () => {
    const key = { surface: 'imessage' as const, externalThreadId: 'chat-guid-1' };
    expect(await threads.getChannelThread(userId, key)).toBeNull();
    const created = await threads.upsertChannelThread(userId, key, {
      conversationId: 'c1',
      lastMessageId: 'm1',
      title: 'iMessage · hello',
    });
    expect(created).toMatchObject({ conversationId: 'c1', lastMessageId: 'm1' });
    const updated = await threads.upsertChannelThread(userId, key, {
      conversationId: 'c1',
      lastMessageId: 'm2',
    });
    expect(updated.lastMessageId).toBe('m2');
    expect(await mongoose.models.ChannelThread.countDocuments({ user: userId })).toBe(1);
  });
});

describe('guardrail state', () => {
  it('records spend and alerts idempotently per month', async () => {
    expect(await guardrails.getGuardrailState(userId, '2026-08')).toBeNull();
    const first = await guardrails.recordBudgetCheck(userId, '2026-08', 60, [1]);
    expect(first.alertedMultiples).toEqual([1]);
    const second = await guardrails.recordBudgetCheck(userId, '2026-08', 130, [1, 2]);
    expect(second.alertedMultiples).toEqual([1, 2]);
    expect(second.spendUsd).toBe(130);
    expect(await mongoose.models.GuardrailState.countDocuments({ user: userId })).toBe(1);
  });
});
