import { Schema, Document } from 'mongoose';

/** Maps an external thread (iMessage chat, email thread) to the web conversation that mirrors it. */
export interface IChannelThread {
  user: string;
  surface: 'imessage' | 'email';
  externalThreadId: string;
  conversationId: string;
  lastMessageId?: string;
  title?: string;
  tenantId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IChannelThreadDocument extends IChannelThread, Document {}

const channelThread: Schema<IChannelThreadDocument> = new Schema<IChannelThreadDocument>(
  {
    user: { type: String, required: true },
    surface: { type: String, enum: ['imessage', 'email'], required: true },
    externalThreadId: { type: String, required: true },
    conversationId: { type: String, required: true, index: true },
    lastMessageId: { type: String },
    title: { type: String },
    tenantId: { type: String, index: true },
  },
  { timestamps: true },
);

channelThread.index({ user: 1, surface: 1, externalThreadId: 1 }, { unique: true });

export default channelThread;
