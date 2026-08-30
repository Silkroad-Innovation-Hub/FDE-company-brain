import type { Model, FlattenMaps, Types } from 'mongoose';
import type {
  IBrainLog,
  IBrainLogDocument,
  BrainLogStatus,
  BrainLogOutcome,
  BrainLogSurface,
  BrainLogDirection,
} from '~/schema/brainLog';

export type BrainLogLean = FlattenMaps<IBrainLog> & { _id: Types.ObjectId };

export interface BrainLogResolution {
  status: BrainLogStatus;
  outcome?: BrainLogOutcome;
  noteId?: string;
  noteType?: string;
  noteContent?: string;
  todoItems?: string[];
  reason?: string;
}

export interface BrainLogAppendData {
  surface: BrainLogSurface;
  direction: BrainLogDirection;
  conversationId?: string;
  messageId: string;
  text: string;
  sender?: string;
  subject?: string;
  /** Pre-resolved on insert (e.g. bulk mail logged but never triaged). */
  resolution?: BrainLogResolution;
}

export interface BrainLogClaimOptions {
  limit?: number;
  quietMs?: number;
  maxAttempts?: number;
}

const DEFAULT_CLAIM_LIMIT = 10;
const DEFAULT_QUIET_MS = 15_000;
const DEFAULT_MAX_ATTEMPTS = 3;

export function createBrainLogMethods(mongoose: typeof import('mongoose')): {
  appendBrainLog: (user: string, data: BrainLogAppendData) => Promise<BrainLogLean | null>;
  claimPendingBrainLogs: (options?: BrainLogClaimOptions) => Promise<BrainLogLean[]>;
  resolveBrainLog: (
    brainLogId: string,
    resolution: BrainLogResolution,
  ) => Promise<BrainLogLean | null>;
  requeueStaleBrainLogs: (staleMs: number) => Promise<number>;
  listBrainLogs: (filter: {
    user?: string;
    status?: BrainLogStatus;
    limit?: number;
  }) => Promise<BrainLogLean[]>;
  getBrainLog: (brainLogId: string) => Promise<BrainLogLean | null>;
  countBrainLogsByStatus: () => Promise<Record<string, number>>;
} {
  const getBrainLogModel = (): Model<IBrainLogDocument> =>
    mongoose.models.BrainLog as Model<IBrainLogDocument>;

  async function appendBrainLog(
    user: string,
    data: BrainLogAppendData,
  ): Promise<BrainLogLean | null> {
    const { resolution } = data;
    const preResolved = resolution
      ? { ...resolution, processedAt: new Date() }
      : { status: 'pending' as const };
    return getBrainLogModel()
      .findOneAndUpdate(
        { messageId: data.messageId },
        {
          $set: {
            text: data.text,
            conversationId: data.conversationId,
            sender: data.sender,
            subject: data.subject,
          },
          $setOnInsert: {
            user,
            surface: data.surface,
            direction: data.direction,
            messageId: data.messageId,
            attempts: 0,
            ...preResolved,
          },
        },
        { upsert: true, new: true },
      )
      .lean<BrainLogLean>();
  }

  async function claimPendingBrainLogs(options?: BrainLogClaimOptions): Promise<BrainLogLean[]> {
    const limit = options?.limit ?? DEFAULT_CLAIM_LIMIT;
    const quietMs = options?.quietMs ?? DEFAULT_QUIET_MS;
    const maxAttempts = options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    const quietBefore = new Date(Date.now() - quietMs);
    const claimed: BrainLogLean[] = [];
    for (let i = 0; i < limit; i++) {
      const entry = await getBrainLogModel()
        .findOneAndUpdate(
          {
            status: 'pending',
            direction: 'inbound',
            updatedAt: { $lte: quietBefore },
            attempts: { $lt: maxAttempts },
          },
          { $set: { status: 'processing' }, $inc: { attempts: 1 } },
          { sort: { updatedAt: 1 }, new: true },
        )
        .lean<BrainLogLean>();
      if (!entry) {
        break;
      }
      claimed.push(entry);
    }
    return claimed;
  }

  async function resolveBrainLog(
    brainLogId: string,
    resolution: BrainLogResolution,
  ): Promise<BrainLogLean | null> {
    return getBrainLogModel()
      .findOneAndUpdate(
        { _id: brainLogId },
        { $set: { ...resolution, processedAt: new Date() } },
        { new: true },
      )
      .lean<BrainLogLean>();
  }

  async function requeueStaleBrainLogs(staleMs: number): Promise<number> {
    const staleBefore = new Date(Date.now() - staleMs);
    const result = await getBrainLogModel().updateMany(
      { status: 'processing', updatedAt: { $lte: staleBefore } },
      { $set: { status: 'pending' } },
    );
    return result.modifiedCount;
  }

  async function listBrainLogs(filter: {
    user?: string;
    status?: BrainLogStatus;
    limit?: number;
  }): Promise<BrainLogLean[]> {
    const query: Record<string, string> = {};
    if (filter.user != null) {
      query.user = filter.user;
    }
    if (filter.status != null) {
      query.status = filter.status;
    }
    return getBrainLogModel()
      .find(query)
      .sort({ updatedAt: -1 })
      .limit(filter.limit ?? 50)
      .lean<BrainLogLean[]>();
  }

  async function getBrainLog(brainLogId: string): Promise<BrainLogLean | null> {
    return getBrainLogModel().findById(brainLogId).lean<BrainLogLean>();
  }

  async function countBrainLogsByStatus(): Promise<Record<string, number>> {
    const rows = await getBrainLogModel().aggregate<{ _id: string; count: number }>([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    return rows.reduce<Record<string, number>>((acc, row) => {
      acc[row._id] = row.count;
      return acc;
    }, {});
  }

  return {
    appendBrainLog,
    claimPendingBrainLogs,
    resolveBrainLog,
    requeueStaleBrainLogs,
    listBrainLogs,
    getBrainLog,
    countBrainLogsByStatus,
  };
}

export type BrainLogMethods = ReturnType<typeof createBrainLogMethods>;
