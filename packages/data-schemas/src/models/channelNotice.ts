import { Model } from 'mongoose';
import channelNoticeSchema, { IChannelNoticeDocument } from '~/schema/channelNotice';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';

export function createChannelNoticeModel(
  mongoose: typeof import('mongoose'),
): Model<IChannelNoticeDocument> {
  applyTenantIsolation(channelNoticeSchema);
  return (
    mongoose.models.ChannelNotice ||
    mongoose.model<IChannelNoticeDocument>('ChannelNotice', channelNoticeSchema)
  );
}
