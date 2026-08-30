import type { Model, FlattenMaps, Types } from 'mongoose';
import type {
  IApproval,
  ApprovalKind,
  ApprovalStatus,
  IApprovalPayload,
  IApprovalDocument,
} from '~/schema/approval';

export type ApprovalLean = FlattenMaps<IApproval> & { _id: Types.ObjectId };

export interface ApprovalCreateData {
  kind: ApprovalKind;
  title: string;
  description: string;
  payload?: IApprovalPayload;
}

export function createApprovalMethods(mongoose: typeof import('mongoose')): {
  getApprovals: (user: string) => Promise<ApprovalLean[]>;
  createApproval: (user: string, data: ApprovalCreateData) => Promise<ApprovalLean>;
  decideApproval: (
    user: string,
    approvalId: string,
    status: Extract<ApprovalStatus, 'approved' | 'denied'>,
  ) => Promise<ApprovalLean | null>;
  reopenApproval: (user: string, approvalId: string) => Promise<ApprovalLean | null>;
} {
  const getApprovalModel = (): Model<IApprovalDocument> =>
    mongoose.models.Approval as Model<IApprovalDocument>;

  async function getApprovals(user: string): Promise<ApprovalLean[]> {
    return getApprovalModel()
      .find({ user })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean<ApprovalLean[]>();
  }

  async function createApproval(user: string, data: ApprovalCreateData): Promise<ApprovalLean> {
    const created = await getApprovalModel().create({
      user,
      kind: data.kind,
      title: data.title,
      description: data.description,
      payload: data.payload ?? {},
    });
    return created.toObject() as ApprovalLean;
  }

  async function decideApproval(
    user: string,
    approvalId: string,
    status: Extract<ApprovalStatus, 'approved' | 'denied'>,
  ): Promise<ApprovalLean | null> {
    return getApprovalModel()
      .findOneAndUpdate(
        { _id: approvalId, user, status: 'pending' },
        { $set: { status, decidedAt: new Date() } },
        { new: true },
      )
      .lean<ApprovalLean>();
  }

  /** Returns a decided approval to pending when its side effect (e.g. sending a draft) failed. */
  async function reopenApproval(user: string, approvalId: string): Promise<ApprovalLean | null> {
    return getApprovalModel()
      .findOneAndUpdate(
        { _id: approvalId, user, status: { $ne: 'pending' } },
        { $set: { status: 'pending' }, $unset: { decidedAt: '' } },
        { new: true },
      )
      .lean<ApprovalLean>();
  }

  return { getApprovals, createApproval, decideApproval, reopenApproval };
}

export type ApprovalMethods = ReturnType<typeof createApprovalMethods>;
