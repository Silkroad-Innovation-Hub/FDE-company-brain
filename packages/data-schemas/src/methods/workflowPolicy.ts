import type { Model, FlattenMaps, Types } from 'mongoose';
import type { IWorkflowPolicy, IWorkflowPolicyDocument } from '~/schema/workflowPolicy';

export type WorkflowPolicyLean = FlattenMaps<IWorkflowPolicy> & { _id: Types.ObjectId };

export interface WorkflowPolicyUpdate {
  enabled?: boolean;
  autoSend?: boolean;
  lastRunAt?: Date;
  lastRunSummary?: string;
}

export function createWorkflowPolicyMethods(mongoose: typeof import('mongoose')): {
  getWorkflowPolicy: (user: string, workflow: string) => Promise<WorkflowPolicyLean | null>;
  listWorkflowPolicies: (user: string) => Promise<WorkflowPolicyLean[]>;
  setWorkflowPolicy: (
    user: string,
    workflow: string,
    update: WorkflowPolicyUpdate,
  ) => Promise<WorkflowPolicyLean>;
} {
  const getModel = (): Model<IWorkflowPolicyDocument> =>
    mongoose.models.WorkflowPolicy as Model<IWorkflowPolicyDocument>;

  async function getWorkflowPolicy(
    user: string,
    workflow: string,
  ): Promise<WorkflowPolicyLean | null> {
    return getModel().findOne({ user, workflow }).lean<WorkflowPolicyLean>();
  }

  async function listWorkflowPolicies(user: string): Promise<WorkflowPolicyLean[]> {
    return getModel().find({ user }).sort({ workflow: 1 }).lean<WorkflowPolicyLean[]>();
  }

  /** Upserts; flipping autoSend on stamps graduatedAt, flipping it off clears it. */
  async function setWorkflowPolicy(
    user: string,
    workflow: string,
    update: WorkflowPolicyUpdate,
  ): Promise<WorkflowPolicyLean> {
    const set: Partial<IWorkflowPolicy> = { ...update };
    const unset: Record<string, ''> = {};
    if (update.autoSend === true) {
      set.graduatedAt = new Date();
    }
    if (update.autoSend === false) {
      unset.graduatedAt = '';
    }
    const policy = await getModel()
      .findOneAndUpdate(
        { user, workflow },
        {
          $set: set,
          ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}),
          $setOnInsert: { user, workflow },
        },
        { upsert: true, new: true },
      )
      .lean<WorkflowPolicyLean>();
    return policy as WorkflowPolicyLean;
  }

  return { getWorkflowPolicy, listWorkflowPolicies, setWorkflowPolicy };
}

export type WorkflowPolicyMethods = ReturnType<typeof createWorkflowPolicyMethods>;
