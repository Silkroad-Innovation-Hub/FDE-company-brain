import { Model } from 'mongoose';
import heartbeatSchema, { IHeartbeatDocument } from '~/schema/heartbeat';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';

export function createHeartbeatModel(
  mongoose: typeof import('mongoose'),
): Model<IHeartbeatDocument> {
  applyTenantIsolation(heartbeatSchema);
  return (
    mongoose.models.Heartbeat || mongoose.model<IHeartbeatDocument>('Heartbeat', heartbeatSchema)
  );
}
