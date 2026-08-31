import { Schema, Document } from 'mongoose';

export type BrainLogStatus =
  | 'pending'
  | 'processing'
  | 'skipped'
  | 'awaiting_approval'
  | 'applied'
  | 'rejected'
  | 'failed';

export type BrainLogOutcome = 'ephemeral' | 'known' | 'merge' | 'create' | 'flagged' | 'bulk';

export type BrainLogSurface = 'chat' | 'email' | 'imessage';

/** `inbound` = authored by a human (owner or third party); `outbound` = authored by the agent. */
export type BrainLogDirection = 'inbound' | 'outbound';

export interface IBrainLog {
  user: string;
  surface: BrainLogSurface;
  direction: BrainLogDirection;
  conversationId?: string;
  messageId: string;
  text: string;
  sender?: string;
  subject?: string;
  status: BrainLogStatus;
  outcome?: BrainLogOutcome;
  noteId?: string;
  noteType?: string;
  noteContent?: string;
  todoItems?: string[];
  reason?: string;
  attempts: number;
  processedAt?: Date;
  embeddedAt?: Date;
  tenantId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IBrainLogDocument extends IBrainLog, Document {}

const brainLog: Schema<IBrainLogDocument> = new Schema<IBrainLogDocument>(
  {
    user: {
      type: String,
      index: true,
      required: true,
    },
    surface: {
      type: String,
      enum: ['chat', 'email', 'imessage'],
      default: 'chat',
    },
    direction: {
      type: String,
      enum: ['inbound', 'outbound'],
      required: true,
    },
    conversationId: {
      type: String,
      index: true,
    },
    messageId: {
      type: String,
      required: true,
      unique: true,
    },
    text: {
      type: String,
      required: true,
    },
    sender: {
      type: String,
    },
    subject: {
      type: String,
    },
    status: {
      type: String,
      enum: [
        'pending',
        'processing',
        'skipped',
        'awaiting_approval',
        'applied',
        'rejected',
        'failed',
      ],
      default: 'pending',
    },
    outcome: {
      type: String,
      enum: ['ephemeral', 'known', 'merge', 'create', 'flagged', 'bulk'],
    },
    noteId: {
      type: String,
    },
    noteType: {
      type: String,
    },
    noteContent: {
      type: String,
    },
    todoItems: {
      type: [String],
      default: undefined,
    },
    reason: {
      type: String,
    },
    attempts: {
      type: Number,
      default: 0,
    },
    processedAt: {
      type: Date,
    },
    embeddedAt: {
      type: Date,
    },
    tenantId: {
      type: String,
      index: true,
    },
  },
  { timestamps: true },
);

brainLog.index({ status: 1, direction: 1, updatedAt: 1 });
brainLog.index({ user: 1, status: 1, tenantId: 1 });
brainLog.index({ user: 1, direction: 1, embeddedAt: 1, createdAt: 1 });

export default brainLog;
