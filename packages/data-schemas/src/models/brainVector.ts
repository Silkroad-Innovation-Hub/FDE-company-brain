import { Model } from 'mongoose';
import brainVectorSchema, { IBrainVectorDocument } from '~/schema/brainVector';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';

export function createBrainVectorModel(
  mongoose: typeof import('mongoose'),
): Model<IBrainVectorDocument> {
  applyTenantIsolation(brainVectorSchema);
  return (
    mongoose.models.BrainVector ||
    mongoose.model<IBrainVectorDocument>('BrainVector', brainVectorSchema)
  );
}
