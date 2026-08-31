import type { Model, FlattenMaps, Types } from 'mongoose';
import type { IHeartbeat, IHeartbeatDocument } from '~/schema/heartbeat';

export type HeartbeatLean = FlattenMaps<IHeartbeat> & { _id: Types.ObjectId };

export function createHeartbeatMethods(mongoose: typeof import('mongoose')): {
  beatHeartbeat: (
    name: string,
    data: { host: string; pid: number; detail?: string },
  ) => Promise<void>;
  listHeartbeats: () => Promise<HeartbeatLean[]>;
} {
  const getModel = (): Model<IHeartbeatDocument> =>
    mongoose.models.Heartbeat as Model<IHeartbeatDocument>;

  async function beatHeartbeat(
    name: string,
    data: { host: string; pid: number; detail?: string },
  ): Promise<void> {
    await getModel().updateOne(
      { name },
      { $set: { ...data, lastSeenAt: new Date() }, $setOnInsert: { name } },
      { upsert: true },
    );
  }

  async function listHeartbeats(): Promise<HeartbeatLean[]> {
    return getModel().find({}).sort({ name: 1 }).lean<HeartbeatLean[]>();
  }

  return { beatHeartbeat, listHeartbeats };
}

export type HeartbeatMethods = ReturnType<typeof createHeartbeatMethods>;
