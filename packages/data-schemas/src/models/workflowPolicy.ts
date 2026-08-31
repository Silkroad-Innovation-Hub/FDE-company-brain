import { Model } from 'mongoose';
import workflowPolicySchema, { IWorkflowPolicyDocument } from '~/schema/workflowPolicy';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';

export function createWorkflowPolicyModel(
  mongoose: typeof import('mongoose'),
): Model<IWorkflowPolicyDocument> {
  applyTenantIsolation(workflowPolicySchema);
  return (
    mongoose.models.WorkflowPolicy ||
    mongoose.model<IWorkflowPolicyDocument>('WorkflowPolicy', workflowPolicySchema)
  );
}
