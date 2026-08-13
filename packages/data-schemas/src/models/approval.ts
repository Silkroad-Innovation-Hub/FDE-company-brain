import { Model } from 'mongoose';
import approvalSchema, { IApprovalDocument } from '~/schema/approval';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';

export function createApprovalModel(mongoose: typeof import('mongoose')): Model<IApprovalDocument> {
  applyTenantIsolation(approvalSchema);
  return mongoose.models.Approval || mongoose.model<IApprovalDocument>('Approval', approvalSchema);
}
