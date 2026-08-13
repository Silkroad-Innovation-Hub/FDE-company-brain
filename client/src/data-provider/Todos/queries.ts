/* Todos */
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { QueryKeys, dataService } from 'librechat-data-provider';
import type {
  UseQueryOptions,
  QueryObserverResult,
  UseMutationResult,
} from '@tanstack/react-query';
import type {
  TTodosResponse,
  TTodoRequest,
  TTodoDeleteResponse,
  TTodo,
} from 'librechat-data-provider';

export const useTodosQuery = (
  config?: UseQueryOptions<TTodosResponse>,
): QueryObserverResult<TTodosResponse> => {
  return useQuery<TTodosResponse>([QueryKeys.todos], () => dataService.getTodos(), {
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    ...config,
  });
};

export const useCreateTodoMutation = (): UseMutationResult<TTodo, unknown, TTodoRequest> => {
  const queryClient = useQueryClient();
  return useMutation((payload: TTodoRequest) => dataService.createTodo(payload), {
    onSuccess: () => {
      queryClient.invalidateQueries([QueryKeys.todos]);
    },
  });
};

export type UpdateTodoParams = { todoId: string; payload: TTodoRequest };
export const useUpdateTodoMutation = (): UseMutationResult<TTodo, unknown, UpdateTodoParams> => {
  const queryClient = useQueryClient();
  return useMutation(
    ({ todoId, payload }: UpdateTodoParams) => dataService.updateTodo(todoId, payload),
    {
      onMutate: async ({ todoId, payload }) => {
        await queryClient.cancelQueries([QueryKeys.todos]);
        const previous = queryClient.getQueryData<TTodosResponse>([QueryKeys.todos]);
        queryClient.setQueryData<TTodosResponse>([QueryKeys.todos], (todos) =>
          (todos ?? []).map((todo) => (todo._id === todoId ? { ...todo, ...payload } : todo)),
        );
        return { previous };
      },
      onError: (_error, _params, context) => {
        const ctx = context as { previous?: TTodosResponse } | undefined;
        if (ctx?.previous) {
          queryClient.setQueryData([QueryKeys.todos], ctx.previous);
        }
      },
      onSettled: () => {
        queryClient.invalidateQueries([QueryKeys.todos]);
      },
    },
  );
};

export const useDeleteTodoMutation = (): UseMutationResult<
  TTodoDeleteResponse,
  unknown,
  string
> => {
  const queryClient = useQueryClient();
  return useMutation((todoId: string) => dataService.deleteTodo(todoId), {
    onSuccess: () => {
      queryClient.invalidateQueries([QueryKeys.todos]);
    },
  });
};
