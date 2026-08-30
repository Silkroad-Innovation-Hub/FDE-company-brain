import { Model } from 'mongoose';
import channelStateSchema, { IChannelStateDocument } from '~/schema/channelState';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';

export function createChannelStateModel(
  mongoose: typeof import('mongoose'),
): Model<IChannelStateDocument> {
  applyTenantIsolation(channelStateSchema);
  return (
    mongoose.models.ChannelState ||
    mongoose.model<IChannelStateDocument>('ChannelState', channelStateSchema)
  );
}
