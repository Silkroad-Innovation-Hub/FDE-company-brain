import { useState } from 'react';
import { Check, Plus, X } from 'lucide-react';
import type { FormEvent } from 'react';
import type { TTodo } from 'librechat-data-provider';
import {
  useTodosQuery,
  useCreateTodoMutation,
  useUpdateTodoMutation,
  useDeleteTodoMutation,
} from '~/data-provider';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';
import Panel from './Panel';

function TodoItem({ todo }: { todo: TTodo }) {
  const localize = useLocalize();
  const updateTodo = useUpdateTodoMutation();
  const deleteTodo = useDeleteTodoMutation();

  const toggle = () => updateTodo.mutate({ todoId: todo._id, payload: { done: !todo.done } });

  return (
    <li className="group flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-surface-hover">
      <button
        type="button"
        role="checkbox"
        aria-checked={todo.done}
        aria-label={todo.done ? localize('com_ui_mark_not_done') : localize('com_ui_mark_done')}
        onClick={toggle}
        className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors',
          todo.done
            ? 'border-border-heavy bg-surface-submit text-white'
            : 'border-border-heavy hover:bg-surface-hover',
        )}
      >
        {todo.done && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
      </button>
      <span
        className={cn(
          'min-w-0 flex-1 break-words text-sm',
          todo.done ? 'text-text-tertiary line-through' : 'text-text-primary',
        )}
      >
        {todo.text}
      </span>
      <button
        type="button"
        aria-label={localize('com_ui_delete_todo')}
        onClick={() => deleteTodo.mutate(todo._id)}
        className="rounded p-1 text-text-tertiary opacity-0 transition-opacity hover:text-text-primary focus:opacity-100 group-hover:opacity-100"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </li>
  );
}

export default function TodoList() {
  const localize = useLocalize();
  const [text, setText] = useState('');
  const { data: todos, isLoading } = useTodosQuery();
  const createTodo = useCreateTodoMutation();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }
    createTodo.mutate({ text: trimmed });
    setText('');
  };

  return (
    <Panel title={localize('com_ui_todos')} className="flex-1">
      <form onSubmit={submit} className="flex items-center gap-2">
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={localize('com_ui_todo_add_placeholder')}
          aria-label={localize('com_ui_todo_add_placeholder')}
          className="min-w-0 flex-1 rounded-lg border border-border-light bg-surface-secondary px-3 py-2 text-sm text-text-primary placeholder-text-tertiary outline-none focus:border-border-heavy"
        />
        <button
          type="submit"
          aria-label={localize('com_ui_add')}
          disabled={!text.trim() || createTodo.isLoading}
          className="rounded-lg border border-border-light p-2 text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:opacity-50"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
        </button>
      </form>
      <TodoListBody todos={todos} isLoading={isLoading} />
    </Panel>
  );
}

function TodoListBody({ todos, isLoading }: { todos?: TTodo[]; isLoading: boolean }) {
  const localize = useLocalize();

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        {[0, 1, 2].map((row) => (
          <div key={row} className="h-9 animate-pulse rounded-lg bg-surface-secondary" />
        ))}
      </div>
    );
  }

  if (!todos || todos.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-text-tertiary">
        {localize('com_ui_todos_empty')}
      </p>
    );
  }

  return (
    <ul className="flex flex-col">
      {todos.map((todo) => (
        <TodoItem key={todo._id} todo={todo} />
      ))}
    </ul>
  );
}
