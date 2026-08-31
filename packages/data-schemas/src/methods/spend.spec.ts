import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createTxMethods } from './tx';
import { matchModelName, findMatchingPattern } from './test-helpers';
import { createTransactionMethods, type TransactionMethods } from './transaction';
import { createModels } from '~/models';

jest.mock('~/config/winston', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

let mongoServer: InstanceType<typeof MongoMemoryServer>;
let methods: TransactionMethods;

const userId = new mongoose.Types.ObjectId();

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  createModels(mongoose);
  const tx = createTxMethods(mongoose, { matchModelName, findMatchingPattern });
  methods = createTransactionMethods(mongoose, {
    getMultiplier: tx.getMultiplier,
    getCacheMultiplier: tx.getCacheMultiplier,
  });
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('sumTransactionValueSince', () => {
  it('sums absolute token value per context inside the window', async () => {
    const Transaction = mongoose.models.Transaction;
    const monthStart = new Date('2026-08-01T00:00:00Z');
    await Transaction.insertMany([
      {
        user: userId,
        tokenType: 'prompt',
        tokenValue: -3_000_000,
        context: 'message',
        createdAt: new Date('2026-08-10'),
      },
      {
        user: userId,
        tokenType: 'completion',
        tokenValue: -2_000_000,
        context: 'message',
        createdAt: new Date('2026-08-11'),
      },
      {
        user: userId,
        tokenType: 'prompt',
        tokenValue: -500_000,
        context: 'channel',
        createdAt: new Date('2026-08-12'),
      },
      {
        user: userId,
        tokenType: 'prompt',
        tokenValue: -9_000_000,
        context: 'message',
        createdAt: new Date('2026-07-30'),
      },
      {
        user: new mongoose.Types.ObjectId(),
        tokenType: 'prompt',
        tokenValue: -7_000_000,
        createdAt: new Date('2026-08-12'),
      },
    ]);
    const summary = await methods.sumTransactionValueSince(String(userId), monthStart);
    expect(summary.totalCredits).toBe(5_500_000);
    expect(summary.byContext).toEqual({ message: 5_000_000, channel: 500_000 });
    expect(summary.since).toEqual(monthStart);
  });
});
