import type { Model, FlattenMaps, Types } from 'mongoose';
import type { IChannelThread, IChannelThreadDocument } from '~/schema/channelThread';

export type ChannelThreadLean = FlattenMaps<IChannelThread> & { _id: Types.ObjectId };

export interface ChannelThreadKey {
  surface: IChannelThread['surface'];
  externalThreadId: string;
}

export function createChannelThreadMethods(mongoose: typeof import('mongoose')): {
  getChannelThread: (user: string, key: ChannelThreadKey) => Promise<ChannelThreadLean | null>;
  upsertChannelThread: (
    user: string,
    key: ChannelThreadKey,
    data: { conversationId: string; lastMessageId?: string; title?: string },
  ) => Promise<ChannelThreadLean>;
} {
  const getModel = (): Model<IChannelThreadDocument> =>
    mongoose.models.ChannelThread as Model<IChannelThreadDocument>;

  async function getChannelThread(
    user: string,
    key: ChannelThreadKey,
  ): Promise<ChannelThreadLean | null> {
    return getModel()
      .findOne({ user, ...key })
      .lean<ChannelThreadLean>();
  }

  async function upsertChannelThread(
    user: string,
    key: ChannelThreadKey,
    data: { conversationId: string; lastMessageId?: string; title?: string },
  ): Promise<ChannelThreadLean> {
    const thread = await getModel()
      .findOneAndUpdate(
        { user, ...key },
        { $set: data, $setOnInsert: { user, ...key } },
        { upsert: true, new: true },
      )
      .lean<ChannelThreadLean>();
    return thread as ChannelThreadLean;
  }

  return { getChannelThread, upsertChannelThread };
}

export type ChannelThreadMethods = ReturnType<typeof createChannelThreadMethods>;
