import type { Model, FlattenMaps, Types } from 'mongoose';
import type { IChannelNotice, IChannelNoticeDocument } from '~/schema/channelNotice';

export type ChannelNoticeLean = FlattenMaps<IChannelNotice> & { _id: Types.ObjectId };

const DEFAULT_CLAIM_LIMIT = 5;
const DEFAULT_MAX_ATTEMPTS = 3;
const STALE_DELIVERING_MS = 5 * 60_000;

export function createChannelNoticeMethods(mongoose: typeof import('mongoose')): {
  createChannelNotice: (user: string, kind: string, text: string) => Promise<ChannelNoticeLean>;
  claimChannelNotices: (
    user: string,
    options?: { limit?: number; maxAttempts?: number },
  ) => Promise<ChannelNoticeLean[]>;
  resolveChannelNotice: (
    noticeId: string,
    outcome: { delivered: boolean; via: string },
  ) => Promise<ChannelNoticeLean | null>;
} {
  const getModel = (): Model<IChannelNoticeDocument> =>
    mongoose.models.ChannelNotice as Model<IChannelNoticeDocument>;

  async function createChannelNotice(
    user: string,
    kind: string,
    text: string,
  ): Promise<ChannelNoticeLean> {
    const created = await getModel().create({ user, kind, text });
    return created.toObject() as ChannelNoticeLean;
  }

  /** Atomically claims pending notices (and stale `delivering` ones) for one connector to deliver. */
  async function claimChannelNotices(
    user: string,
    options: { limit?: number; maxAttempts?: number } = {},
  ): Promise<ChannelNoticeLean[]> {
    const limit = options.limit ?? DEFAULT_CLAIM_LIMIT;
    const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    const staleBefore = new Date(Date.now() - STALE_DELIVERING_MS);
    const claimed: ChannelNoticeLean[] = [];
    for (let i = 0; i < limit; i++) {
      const notice = await getModel()
        .findOneAndUpdate(
          {
            user,
            attempts: { $lt: maxAttempts },
            $or: [
              { status: 'pending' },
              { status: 'delivering', updatedAt: { $lte: staleBefore } },
            ],
          },
          { $set: { status: 'delivering' }, $inc: { attempts: 1 } },
          { sort: { createdAt: 1 }, new: true },
        )
        .lean<ChannelNoticeLean>();
      if (!notice) {
        break;
      }
      claimed.push(notice);
    }
    return claimed;
  }

  async function resolveChannelNotice(
    noticeId: string,
    outcome: { delivered: boolean; via: string },
  ): Promise<ChannelNoticeLean | null> {
    const update = outcome.delivered
      ? { status: 'delivered', deliveredVia: outcome.via, deliveredAt: new Date() }
      : { status: 'pending' };
    return getModel()
      .findOneAndUpdate({ _id: noticeId }, { $set: update }, { new: true })
      .lean<ChannelNoticeLean>();
  }

  return { createChannelNotice, claimChannelNotices, resolveChannelNotice };
}

export type ChannelNoticeMethods = ReturnType<typeof createChannelNoticeMethods>;
