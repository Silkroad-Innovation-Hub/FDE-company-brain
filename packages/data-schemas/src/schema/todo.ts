import { Schema, Document } from 'mongoose';

export interface ITodo {
  user: string;
  text: string;
  done: boolean;
  position: number;
  dueDate?: Date;
  tenantId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ITodoDocument extends ITodo, Document {}

const todo: Schema<ITodoDocument> = new Schema<ITodoDocument>(
  {
    user: {
      type: String,
      index: true,
      required: true,
    },
    text: {
      type: String,
      required: true,
    },
    done: {
      type: Boolean,
      default: false,
    },
    position: {
      type: Number,
      default: 0,
    },
    dueDate: {
      type: Date,
    },
    tenantId: {
      type: String,
      index: true,
    },
  },
  { timestamps: true },
);

todo.index({ user: 1, done: 1, position: 1, tenantId: 1 });

export default todo;
