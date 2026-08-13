import { Model } from 'mongoose';
import todoSchema, { ITodoDocument } from '~/schema/todo';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';

export function createTodoModel(mongoose: typeof import('mongoose')): Model<ITodoDocument> {
  applyTenantIsolation(todoSchema);
  return mongoose.models.Todo || mongoose.model<ITodoDocument>('Todo', todoSchema);
}
