import { Schema, Document } from 'mongoose';

/**
 * Per-owner, per-workflow trust ramp (brief §6): outbound stays draft+approval
 * until a workflow is explicitly graduated to auto-send, and every graduation
 * is recorded.
 */
export interface IWorkflowPolicy {
  user: string;
  workflow: string;
  enabled: boolean;
  autoSend: boolean;
  graduatedAt?: Date;
  lastRunAt?: Date;
  lastRunSummary?: string;
  tenantId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IWorkflowPolicyDocument extends IWorkflowPolicy, Document {}

const workflowPolicy: Schema<IWorkflowPolicyDocument> = new Schema<IWorkflowPolicyDocument>(
  {
    user: { type: String, required: true },
    workflow: { type: String, required: true },
    enabled: { type: Boolean, default: true },
    autoSend: { type: Boolean, default: false },
    graduatedAt: { type: Date },
    lastRunAt: { type: Date },
    lastRunSummary: { type: String },
    tenantId: { type: String, index: true },
  },
  { timestamps: true },
);

workflowPolicy.index({ user: 1, workflow: 1 }, { unique: true });

export default workflowPolicy;
