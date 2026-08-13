import { Schema, Document } from 'mongoose';

export type ApprovalKind = 'email' | 'message' | 'document';
export type ApprovalStatus = 'pending' | 'approved' | 'denied';

export interface IApprovalChange {
  field: string;
  before: string;
  after: string;
}

export interface IApprovalPayload {
  to?: string;
  cc?: string;
  subject?: string;
  body?: string;
  channel?: string;
  recipient?: string;
  text?: string;
  document?: string;
  summary?: string;
  changes?: IApprovalChange[];
}

export interface IApproval {
  user: string;
  kind: ApprovalKind;
  title: string;
  description: string;
  status: ApprovalStatus;
  payload: IApprovalPayload;
  decidedAt?: Date;
  tenantId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IApprovalDocument extends IApproval, Document {}

const change = new Schema<IApprovalChange>(
  {
    field: { type: String, required: true },
    before: { type: String, default: '' },
    after: { type: String, default: '' },
  },
  { _id: false },
);

const payload = new Schema<IApprovalPayload>(
  {
    to: { type: String },
    cc: { type: String },
    subject: { type: String },
    body: { type: String },
    channel: { type: String },
    recipient: { type: String },
    text: { type: String },
    document: { type: String },
    summary: { type: String },
    changes: { type: [change], default: undefined },
  },
  { _id: false },
);

const approval: Schema<IApprovalDocument> = new Schema<IApprovalDocument>(
  {
    user: {
      type: String,
      index: true,
      required: true,
    },
    kind: {
      type: String,
      enum: ['email', 'message', 'document'],
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'denied'],
      default: 'pending',
      index: true,
    },
    payload: {
      type: payload,
      default: {},
    },
    decidedAt: {
      type: Date,
    },
    tenantId: {
      type: String,
      index: true,
    },
  },
  { timestamps: true },
);

approval.index({ user: 1, status: 1, createdAt: -1, tenantId: 1 });

export default approval;
