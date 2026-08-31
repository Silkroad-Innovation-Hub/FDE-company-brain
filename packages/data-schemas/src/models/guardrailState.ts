import { Model } from 'mongoose';
import guardrailStateSchema, { IGuardrailStateDocument } from '~/schema/guardrailState';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';

export function createGuardrailStateModel(
  mongoose: typeof import('mongoose'),
): Model<IGuardrailStateDocument> {
  applyTenantIsolation(guardrailStateSchema);
  return (
    mongoose.models.GuardrailState ||
    mongoose.model<IGuardrailStateDocument>('GuardrailState', guardrailStateSchema)
  );
}
