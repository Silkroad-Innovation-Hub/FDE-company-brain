import { Schema, Document } from 'mongoose';

/** Per-owner, per-month record of which budget thresholds have already fired. */
export interface IGuardrailState {
  user: string;
  month: string;
  alertedMultiples: number[];
  spendUsd: number;
  checkedAt?: Date;
  tenantId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IGuardrailStateDocument extends IGuardrailState, Document {}

const guardrailState: Schema<IGuardrailStateDocument> = new Schema<IGuardrailStateDocument>(
  {
    user: { type: String, required: true },
    month: { type: String, required: true },
    alertedMultiples: { type: [Number], default: [] },
    spendUsd: { type: Number, default: 0 },
    checkedAt: { type: Date },
    tenantId: { type: String, index: true },
  },
  { timestamps: true },
);

guardrailState.index({ user: 1, month: 1 }, { unique: true });

export default guardrailState;
