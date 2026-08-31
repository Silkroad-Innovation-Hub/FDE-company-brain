import type { Model, FlattenMaps, FilterQuery, Types } from 'mongoose';
import type { IBrainVector, IBrainVectorDocument, BrainVectorKind } from '~/schema/brainVector';
import { tenantSafeBulkWrite } from '~/utils/tenantBulkWrite';

export type BrainVectorLean = FlattenMaps<IBrainVector> & { _id: Types.ObjectId };

export interface BrainVectorUpsert {
  kind: BrainVectorKind;
  refId: string;
  chunk: number;
  title: string;
  text: string;
  hash: string;
  embedModel: string;
  dims: number;
  vector: Buffer;
  surface?: string;
  sender?: string;
  sourceAt?: Date;
}

export interface BrainVectorListOptions {
  kind?: BrainVectorKind;
  /** Only vectors updated after this instant (incremental cache refresh). */
  updatedAfter?: Date;
  /** Only log vectors whose source is newer than this (retrieval window). */
  sourceAfter?: Date;
  limit?: number;
}

const DEFAULT_LIST_LIMIT = 20_000;

interface BinaryLike {
  buffer: Uint8Array;
}

/** Lean reads return BSON Binary for Buffer fields; callers always get a Node Buffer. */
function toBuffer(stored: Buffer | BinaryLike): Buffer {
  if (Buffer.isBuffer(stored)) {
    return stored;
  }
  return Buffer.from(stored.buffer.buffer, stored.buffer.byteOffset, stored.buffer.byteLength);
}

export function createBrainVectorMethods(mongoose: typeof import('mongoose')): {
  upsertBrainVectors: (user: string, units: BrainVectorUpsert[]) => Promise<number>;
  listBrainVectors: (user: string, options?: BrainVectorListOptions) => Promise<BrainVectorLean[]>;
  listBrainVectorHashes: (
    user: string,
    kind: BrainVectorKind,
    refId: string,
  ) => Promise<Array<{ chunk: number; hash: string }>>;
  deleteBrainVectors: (
    user: string,
    kind: BrainVectorKind,
    refId: string,
    keepChunks?: number[],
  ) => Promise<number>;
  countBrainVectors: (user: string) => Promise<Record<string, number>>;
} {
  const getModel = (): Model<IBrainVectorDocument> =>
    mongoose.models.BrainVector as Model<IBrainVectorDocument>;

  async function upsertBrainVectors(user: string, units: BrainVectorUpsert[]): Promise<number> {
    if (units.length === 0) {
      return 0;
    }
    const result = await tenantSafeBulkWrite(
      getModel(),
      units.map((unit) => ({
        updateOne: {
          filter: { user, kind: unit.kind, refId: unit.refId, chunk: unit.chunk },
          update: { $set: { ...unit, user } },
          upsert: true,
        },
      })),
      { ordered: false },
    );
    return result.upsertedCount + result.modifiedCount;
  }

  async function listBrainVectors(
    user: string,
    options: BrainVectorListOptions = {},
  ): Promise<BrainVectorLean[]> {
    const query: FilterQuery<IBrainVectorDocument> = { user };
    if (options.kind) {
      query.kind = options.kind;
    }
    if (options.updatedAfter) {
      query.updatedAt = { $gt: options.updatedAfter };
    }
    if (options.sourceAfter) {
      query.$or = [{ kind: 'note' }, { sourceAt: { $gte: options.sourceAfter } }];
    }
    const rows = await getModel()
      .find(query)
      .sort({ updatedAt: 1 })
      .limit(options.limit ?? DEFAULT_LIST_LIMIT)
      .lean<BrainVectorLean[]>();
    return rows.map((row) => ({ ...row, vector: toBuffer(row.vector) }));
  }

  async function listBrainVectorHashes(
    user: string,
    kind: BrainVectorKind,
    refId: string,
  ): Promise<Array<{ chunk: number; hash: string }>> {
    return getModel()
      .find({ user, kind, refId }, { chunk: 1, hash: 1, _id: 0 })
      .lean<Array<{ chunk: number; hash: string }>>();
  }

  async function deleteBrainVectors(
    user: string,
    kind: BrainVectorKind,
    refId: string,
    keepChunks?: number[],
  ): Promise<number> {
    const filter =
      keepChunks && keepChunks.length > 0
        ? { user, kind, refId, chunk: { $nin: keepChunks } }
        : { user, kind, refId };
    const result = await getModel().deleteMany(filter);
    return result.deletedCount;
  }

  async function countBrainVectors(user: string): Promise<Record<string, number>> {
    const rows = await getModel().aggregate<{ _id: string; count: number }>([
      { $match: { user } },
      { $group: { _id: '$kind', count: { $sum: 1 } } },
    ]);
    return rows.reduce<Record<string, number>>((acc, row) => {
      acc[row._id] = row.count;
      return acc;
    }, {});
  }

  return {
    upsertBrainVectors,
    listBrainVectors,
    listBrainVectorHashes,
    deleteBrainVectors,
    countBrainVectors,
  };
}

export type BrainVectorMethods = ReturnType<typeof createBrainVectorMethods>;
