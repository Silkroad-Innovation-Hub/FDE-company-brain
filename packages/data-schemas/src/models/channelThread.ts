import { Model } from 'mongoose';
import channelThreadSchema, { IChannelThreadDocument } from '~/schema/channelThread';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';

export function createChannelThreadModel(
  mongoose: typeof import('mongoose'),
): Model<IChannelThreadDocument> {
  applyTenantIsolation(channelThreadSchema);
  return (
    mongoose.models.ChannelThread ||
    mongoose.model<IChannelThreadDocument>('ChannelThread', channelThreadSchema)
  );
}
