import type { Model, FlattenMaps, Types } from 'mongoose';
import type { IChannelState, IChannelStateDocument } from '~/schema/channelState';

export type ChannelStateLean = FlattenMaps<IChannelState> & { _id: Types.ObjectId };

export function createChannelStateMethods(mongoose: typeof import('mongoose')): {
  isChannelsPaused: (user: string) => Promise<boolean>;
  setChannelsPaused: (user: string, paused: boolean, via: string) => Promise<ChannelStateLean>;
} {
  const getChannelStateModel = (): Model<IChannelStateDocument> =>
    mongoose.models.ChannelState as Model<IChannelStateDocument>;

  async function isChannelsPaused(user: string): Promise<boolean> {
    const state = await getChannelStateModel().findOne({ user }).lean<ChannelStateLean>();
    return state?.paused === true;
  }

  async function setChannelsPaused(
    user: string,
    paused: boolean,
    via: string,
  ): Promise<ChannelStateLean> {
    const state = await getChannelStateModel()
      .findOneAndUpdate(
        { user },
        { $set: { paused, pausedAt: paused ? new Date() : undefined, pausedVia: via } },
        { upsert: true, new: true },
      )
      .lean<ChannelStateLean>();
    return state as ChannelStateLean;
  }

  return { isChannelsPaused, setChannelsPaused };
}

export type ChannelStateMethods = ReturnType<typeof createChannelStateMethods>;
