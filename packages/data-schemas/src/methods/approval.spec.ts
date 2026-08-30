import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApprovalMethods, type ApprovalMethods } from './approval';
import { createModels } from '~/models';

jest.mock('~/config/winston', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

let mongoServer: InstanceType<typeof MongoMemoryServer>;
let methods: ApprovalMethods;

const userId = new mongoose.Types.ObjectId().toString();

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  createModels(mongoose);
  methods = createApprovalMethods(mongoose);
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('approval decisions', () => {
  it('stores a Gmail draftId, decides once, and can reopen after a failed side effect', async () => {
    const created = await methods.createApproval(userId, {
      kind: 'email',
      title: 'Chase Henderson invoice',
      description: 'Draft ready — send?',
      payload: {
        to: 'ap@henderson.com',
        subject: 'Invoice 1042',
        body: 'Hi Dana…',
        draftId: 'r-1',
      },
    });
    expect(created.payload.draftId).toBe('r-1');

    const approved = await methods.decideApproval(userId, String(created._id), 'approved');
    expect(approved?.status).toBe('approved');
    expect(await methods.decideApproval(userId, String(created._id), 'denied')).toBeNull();

    const reopened = await methods.reopenApproval(userId, String(created._id));
    expect(reopened?.status).toBe('pending');
    expect(reopened?.decidedAt).toBeUndefined();
    expect(await methods.reopenApproval(userId, String(created._id))).toBeNull();
  });
});
