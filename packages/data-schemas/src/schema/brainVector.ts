import { Schema, Document } from 'mongoose';

export type BrainVectorKind = 'note' | 'log';

/**
 * One embedded chunk of the company brain — a vault note section or a raw-log
 * entry. Vectors are float32 buffers; similarity is computed in-process
 * (context/unification.md §1) until Silkroad core brings pgvector.
 */
export interface IBrainVector {
  user: string;
  kind: BrainVectorKind;
  refId: string;
  chunk: number;
  title: string;
  text: string;
  hash: string;
  embedModel: string;
  dims: number;
  vector: Buffer;
  surface?: string;
  sender?: string;
  sourceAt?: Date;
  tenantId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IBrainVectorDocument extends IBrainVector, Document {}

const brainVector: Schema<IBrainVectorDocument> = new Schema<IBrainVectorDocument>(
  {
    user: { type: String, required: true },
    kind: { type: String, enum: ['note', 'log'], required: true },
    refId: { type: String, required: true },
    chunk: { type: Number, required: true, default: 0 },
    title: { type: String, required: true },
    text: { type: String, required: true },
    hash: { type: String, required: true },
    embedModel: { type: String, required: true },
    dims: { type: Number, required: true },
    vector: { type: Buffer, required: true },
    surface: { type: String },
    sender: { type: String },
    sourceAt: { type: Date },
    tenantId: { type: String, index: true },
  },
  { timestamps: true },
);

brainVector.index({ user: 1, kind: 1, refId: 1, chunk: 1 }, { unique: true });
brainVector.index({ user: 1, kind: 1, updatedAt: 1 });

export default brainVector;
