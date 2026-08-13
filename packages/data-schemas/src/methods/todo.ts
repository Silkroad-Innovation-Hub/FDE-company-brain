import type { Model, FlattenMaps, Types } from 'mongoose';
import type { ITodo, ITodoDocument } from '~/schema/todo';

export type TodoLean = FlattenMaps<ITodo> & { _id: Types.ObjectId };

export interface TodoCreateData {
  text: string;
  dueDate?: Date | string;
  position?: number;
}

export interface TodoUpdateData {
  text?: string;
  done?: boolean;
  dueDate?: Date | string | null;
  position?: number;
}

export function createTodoMethods(mongoose: typeof import('mongoose')): {
  getTodos: (user: string) => Promise<TodoLean[]>;
  createTodo: (user: string, data: TodoCreateData) => Promise<TodoLean>;
  updateTodo: (user: string, todoId: string, data: TodoUpdateData) => Promise<TodoLean | null>;
  deleteTodo: (user: string, todoId: string) => Promise<boolean>;
} {
  const getTodoModel = (): Model<ITodoDocument> => mongoose.models.Todo as Model<ITodoDocument>;

  async function getTodos(user: string): Promise<TodoLean[]> {
    return getTodoModel()
      .find({ user })
      .sort({ done: 1, position: 1, createdAt: -1 })
      .lean<TodoLean[]>();
  }

  async function createTodo(user: string, data: TodoCreateData): Promise<TodoLean> {
    const created = await getTodoModel().create({
      user,
      text: data.text,
      dueDate: data.dueDate,
      position: data.position ?? 0,
    });
    return created.toObject() as TodoLean;
  }

  async function updateTodo(
    user: string,
    todoId: string,
    data: TodoUpdateData,
  ): Promise<TodoLean | null> {
    return getTodoModel()
      .findOneAndUpdate({ _id: todoId, user }, { $set: data }, { new: true })
      .lean<TodoLean>();
  }

  async function deleteTodo(user: string, todoId: string): Promise<boolean> {
    const result = await getTodoModel().deleteOne({ _id: todoId, user });
    return result.deletedCount > 0;
  }

  return { getTodos, createTodo, updateTodo, deleteTodo };
}

export type TodoMethods = ReturnType<typeof createTodoMethods>;
