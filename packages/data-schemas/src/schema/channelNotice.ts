import { Schema, Document } from 'mongoose';

export type ChannelNoticeStatus = 'pending' | 'delivering' | 'delivered' | 'failed';

/**
 * An agent-initiated message to the owner (budget alerts, later the morning
 * brief). Written by server-side processes, delivered by whichever connector
 * claims it first — always through the owner-only send guards.
 */
export interface IChannelNotice {
  user: string;
  kind: string;
  text: string;
  status: ChannelNoticeStatus;
  deliveredVia?: string;
  deliveredAt?: Date;
  attempts: number;
  tenantId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IChannelNoticeDocument extends IChannelNotice, Document {}

const channelNotice: Schema<IChannelNoticeDocument> = new Schema<IChannelNoticeDocument>(
  {
    user: { type: String, required: true },
    kind: { type: String, required: true },
    text: { type: String, required: true },
    status: {
      type: String,
      enum: ['pending', 'delivering', 'delivered', 'failed'],
      default: 'pending',
    },
    deliveredVia: { type: String },
    deliveredAt: { type: Date },
    attempts: { type: Number, default: 0 },
    tenantId: { type: String, index: true },
  },
  { timestamps: true },
);

channelNotice.index({ user: 1, status: 1, createdAt: 1 });

export default channelNotice;
