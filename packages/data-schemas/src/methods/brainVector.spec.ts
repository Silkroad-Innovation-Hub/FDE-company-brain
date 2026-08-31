import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createBrainVectorMethods, type BrainVectorMethods } from './brainVector';
import { createModels } from '~/models';

jest.mock('~/config/winston', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

let mongoServer: InstanceType<typeof MongoMemoryServer>;
let methods: BrainVectorMethods;

const userId = new mongoose.Types.ObjectId().toString();

function unit(kind: 'note' | 'log', refId: string, chunk: number, text: string, sourceAt?: Date) {
  return {
    kind,
    refId,
    chunk,
    title: refId,
    text,
    hash: `h-${text}`,
    embedModel: 'fake-embed',
    dims: 2,
    vector: Buffer.from(new Float32Array([1, 0]).buffer),
    sourceAt,
  };
}

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  createModels(mongoose);
  methods = createBrainVectorMethods(mongoose);
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await mongoose.models.BrainVector.deleteMany({});
});

describe('brain vectors', () => {
  it('upserts by (kind, refId, chunk), lists incrementally, and prunes stale chunks', async () => {
    await methods.upsertBrainVectors(userId, [
      unit('note', 'Acme', 0, 'acme summary'),
      unit('note', 'Acme', 1, 'acme deal terms'),
    ]);
    await methods.upsertBrainVectors(userId, [unit('note', 'Acme', 0, 'acme summary v2')]);
    expect(await mongoose.models.BrainVector.countDocuments({ user: userId })).toBe(2);

    const hashes = await methods.listBrainVectorHashes(userId, 'note', 'Acme');
    expect(hashes.map((h) => h.hash).sort()).toEqual(['h-acme deal terms', 'h-acme summary v2']);

    const pruned = await methods.deleteBrainVectors(userId, 'note', 'Acme', [0]);
    expect(pruned).toBe(1);

    const all = await methods.listBrainVectors(userId);
    expect(all).toHaveLength(1);
    expect(Buffer.isBuffer(all[0].vector)).toBe(true);
    const later = await methods.listBrainVectors(userId, {
      updatedAfter: new Date(Date.now() + 1000),
    });
    expect(later).toHaveLength(0);
  });

  it('windows log vectors by source time while keeping every note', async () => {
    const old = new Date(Date.now() - 100 * 86_400_000);
    await methods.upsertBrainVectors(userId, [
      unit('note', 'Acme', 0, 'acme'),
      unit('log', 'log-old', 0, 'old text', old),
      unit('log', 'log-new', 0, 'new text', new Date()),
    ]);
    const windowed = await methods.listBrainVectors(userId, {
      sourceAfter: new Date(Date.now() - 90 * 86_400_000),
    });
    expect(windowed.map((v) => v.refId).sort()).toEqual(['Acme', 'log-new']);
    expect(await methods.countBrainVectors(userId)).toEqual({ note: 1, log: 2 });
  });
});
