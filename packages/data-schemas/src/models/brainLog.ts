import { Model } from 'mongoose';
import brainLogSchema, { IBrainLogDocument } from '~/schema/brainLog';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';

export function createBrainLogModel(mongoose: typeof import('mongoose')): Model<IBrainLogDocument> {
  applyTenantIsolation(brainLogSchema);
  return mongoose.models.BrainLog || mongoose.model<IBrainLogDocument>('BrainLog', brainLogSchema);
}
