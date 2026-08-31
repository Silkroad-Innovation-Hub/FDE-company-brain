/* Workflows */
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { QueryKeys, dataService } from 'librechat-data-provider';
import type {
  UseQueryOptions,
  QueryObserverResult,
  UseMutationResult,
} from '@tanstack/react-query';
import type {
  TWorkflowPoliciesResponse,
  TWorkflowPolicyUpdate,
  TWorkflowRunResponse,
  TWorkflowsHealth,
  TWorkflowPolicy,
  TWorkflowName,
} from 'librechat-data-provider';

const HEALTH_REFETCH_MS = 30_000;

export const useWorkflowPoliciesQuery = (
  config?: UseQueryOptions<TWorkflowPoliciesResponse>,
): QueryObserverResult<TWorkflowPoliciesResponse> => {
  return useQuery<TWorkflowPoliciesResponse>(
    [QueryKeys.workflowPolicies],
    () => dataService.getWorkflowPolicies(),
    {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      ...config,
    },
  );
};

export type UpdateWorkflowPolicyParams = {
  workflow: TWorkflowName;
  payload: TWorkflowPolicyUpdate;
};

export const useUpdateWorkflowPolicyMutation = (): UseMutationResult<
  TWorkflowPolicy,
  unknown,
  UpdateWorkflowPolicyParams
> => {
  const queryClient = useQueryClient();
  return useMutation(
    ({ workflow, payload }: UpdateWorkflowPolicyParams) =>
      dataService.updateWorkflowPolicy(workflow, payload),
    {
      onMutate: async ({ workflow, payload }) => {
        await queryClient.cancelQueries([QueryKeys.workflowPolicies]);
        const previous = queryClient.getQueryData<TWorkflowPoliciesResponse>([
          QueryKeys.workflowPolicies,
        ]);
        queryClient.setQueryData<TWorkflowPoliciesResponse>(
          [QueryKeys.workflowPolicies],
          (policies) =>
            (policies ?? []).map((policy) =>
              policy.workflow === workflow ? { ...policy, ...payload } : policy,
            ),
        );
        return { previous };
      },
      onError: (_error, _params, context) => {
        const ctx = context as { previous?: TWorkflowPoliciesResponse } | undefined;
        if (ctx?.previous) {
          queryClient.setQueryData([QueryKeys.workflowPolicies], ctx.previous);
        }
      },
      onSettled: () => {
        queryClient.invalidateQueries([QueryKeys.workflowPolicies]);
        queryClient.invalidateQueries([QueryKeys.guardrailsActivity]);
      },
    },
  );
};

export const useWorkflowsHealthQuery = (
  config?: UseQueryOptions<TWorkflowsHealth>,
): QueryObserverResult<TWorkflowsHealth> => {
  return useQuery<TWorkflowsHealth>(
    [QueryKeys.workflowsHealth],
    () => dataService.getWorkflowsHealth(),
    {
      refetchInterval: HEALTH_REFETCH_MS,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      ...config,
    },
  );
};

export const useRunWorkflowMutation = (): UseMutationResult<
  TWorkflowRunResponse,
  unknown,
  TWorkflowName
> => {
  const queryClient = useQueryClient();
  return useMutation((workflow: TWorkflowName) => dataService.runWorkflow(workflow), {
    onSettled: () => {
      queryClient.invalidateQueries([QueryKeys.workflowPolicies]);
      queryClient.invalidateQueries([QueryKeys.approvals]);
      queryClient.invalidateQueries([QueryKeys.guardrailsActivity]);
    },
  });
};
