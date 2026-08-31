import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createWorkflowPolicyMethods, type WorkflowPolicyMethods } from './workflowPolicy';
import { createHeartbeatMethods, type HeartbeatMethods } from './heartbeat';
import { createModels } from '~/models';

jest.mock('~/config/winston', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

let mongoServer: InstanceType<typeof MongoMemoryServer>;
let policies: WorkflowPolicyMethods;
let heartbeats: HeartbeatMethods;

const userId = new mongoose.Types.ObjectId().toString();

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  createModels(mongoose);
  policies = createWorkflowPolicyMethods(mongoose);
  heartbeats = createHeartbeatMethods(mongoose);
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('workflow policies', () => {
  it('upserts per workflow and stamps graduation only when auto-send turns on', async () => {
    expect(await policies.getWorkflowPolicy(userId, 'chase')).toBeNull();
    const created = await policies.setWorkflowPolicy(userId, 'chase', { enabled: true });
    expect(created).toMatchObject({ workflow: 'chase', enabled: true, autoSend: false });
    expect(created.graduatedAt).toBeUndefined();

    const graduated = await policies.setWorkflowPolicy(userId, 'chase', { autoSend: true });
    expect(graduated.autoSend).toBe(true);
    expect(graduated.graduatedAt).toBeInstanceOf(Date);

    const revoked = await policies.setWorkflowPolicy(userId, 'chase', { autoSend: false });
    expect(revoked.autoSend).toBe(false);
    expect(revoked.graduatedAt).toBeUndefined();

    await policies.setWorkflowPolicy(userId, 'brief', { lastRunSummary: 'ok' });
    expect((await policies.listWorkflowPolicies(userId)).map((p) => p.workflow)).toEqual([
      'brief',
      'chase',
    ]);
    expect(await mongoose.models.WorkflowPolicy.countDocuments({ user: userId })).toBe(2);
  });
});

describe('heartbeats', () => {
  it('keeps one row per process and refreshes lastSeenAt', async () => {
    await heartbeats.beatHeartbeat('silkroad-worker', { host: 'mac', pid: 1, detail: 'v1' });
    const first = (await heartbeats.listHeartbeats())[0];
    await heartbeats.beatHeartbeat('silkroad-worker', { host: 'mac', pid: 2 });
    const rows = await heartbeats.listHeartbeats();
    expect(rows).toHaveLength(1);
    expect(rows[0].pid).toBe(2);
    expect(rows[0].lastSeenAt.getTime()).toBeGreaterThanOrEqual(first.lastSeenAt.getTime());
  });
});
