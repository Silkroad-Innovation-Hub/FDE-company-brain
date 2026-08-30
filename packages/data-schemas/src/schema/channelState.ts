import { Schema, Document } from 'mongoose';

/**
 * Per-owner kill switch for the channel connectors and the distiller
 * (brief §6: "pause everything" over any channel must work).
 */
export interface IChannelState {
  user: string;
  paused: boolean;
  pausedAt?: Date;
  pausedVia?: string;
  tenantId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IChannelStateDocument extends IChannelState, Document {}

const channelState: Schema<IChannelStateDocument> = new Schema<IChannelStateDocument>(
  {
    user: {
      type: String,
      required: true,
      unique: true,
    },
    paused: {
      type: Boolean,
      default: false,
    },
    pausedAt: {
      type: Date,
    },
    pausedVia: {
      type: String,
    },
    tenantId: {
      type: String,
      index: true,
    },
  },
  { timestamps: true },
);

export default channelState;
