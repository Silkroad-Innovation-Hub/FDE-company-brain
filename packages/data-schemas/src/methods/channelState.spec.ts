import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createChannelStateMethods, type ChannelStateMethods } from './channelState';
import { createModels } from '~/models';

jest.mock('~/config/winston', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

let mongoServer: InstanceType<typeof MongoMemoryServer>;
let methods: ChannelStateMethods;

const userId = new mongoose.Types.ObjectId().toString();

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  createModels(mongoose);
  methods = createChannelStateMethods(mongoose);
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('channel state kill switch', () => {
  it('defaults to not paused and round-trips pause/resume', async () => {
    expect(await methods.isChannelsPaused(userId)).toBe(false);

    const paused = await methods.setChannelsPaused(userId, true, 'imessage');
    expect(paused).toMatchObject({ user: userId, paused: true, pausedVia: 'imessage' });
    expect(paused.pausedAt).toBeInstanceOf(Date);
    expect(await methods.isChannelsPaused(userId)).toBe(true);

    await methods.setChannelsPaused(userId, false, 'email');
    expect(await methods.isChannelsPaused(userId)).toBe(false);
    expect(await mongoose.models.ChannelState.countDocuments({ user: userId })).toBe(1);
  });
});
