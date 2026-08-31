import { Schema, Document } from 'mongoose';

/** Liveness of the long-running Silkroad processes (worker, connectors), one row per process name. */
export interface IHeartbeat {
  name: string;
  host: string;
  pid: number;
  lastSeenAt: Date;
  detail?: string;
  tenantId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IHeartbeatDocument extends IHeartbeat, Document {}

const heartbeat: Schema<IHeartbeatDocument> = new Schema<IHeartbeatDocument>(
  {
    name: { type: String, required: true, unique: true },
    host: { type: String, required: true },
    pid: { type: Number, required: true },
    lastSeenAt: { type: Date, required: true },
    detail: { type: String },
    tenantId: { type: String, index: true },
  },
  { timestamps: true },
);

export default heartbeat;
