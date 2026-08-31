import type { Model, FlattenMaps, Types } from 'mongoose';
import type { IGuardrailState, IGuardrailStateDocument } from '~/schema/guardrailState';

export type GuardrailStateLean = FlattenMaps<IGuardrailState> & { _id: Types.ObjectId };

export function createGuardrailStateMethods(mongoose: typeof import('mongoose')): {
  getGuardrailState: (user: string, month: string) => Promise<GuardrailStateLean | null>;
  recordBudgetCheck: (
    user: string,
    month: string,
    spendUsd: number,
    newMultiples: number[],
  ) => Promise<GuardrailStateLean>;
} {
  const getModel = (): Model<IGuardrailStateDocument> =>
    mongoose.models.GuardrailState as Model<IGuardrailStateDocument>;

  async function getGuardrailState(
    user: string,
    month: string,
  ): Promise<GuardrailStateLean | null> {
    return getModel().findOne({ user, month }).lean<GuardrailStateLean>();
  }

  /** Stores the latest spend and marks the given thresholds as alerted (idempotent per month). */
  async function recordBudgetCheck(
    user: string,
    month: string,
    spendUsd: number,
    newMultiples: number[],
  ): Promise<GuardrailStateLean> {
    const state = await getModel()
      .findOneAndUpdate(
        { user, month },
        {
          $set: { spendUsd, checkedAt: new Date() },
          $addToSet: { alertedMultiples: { $each: newMultiples } },
          $setOnInsert: { user, month },
        },
        { upsert: true, new: true },
      )
      .lean<GuardrailStateLean>();
    return state as GuardrailStateLean;
  }

  return { getGuardrailState, recordBudgetCheck };
}

export type GuardrailStateMethods = ReturnType<typeof createGuardrailStateMethods>;
