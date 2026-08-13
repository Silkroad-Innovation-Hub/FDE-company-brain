/* Approvals */
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { QueryKeys, dataService } from 'librechat-data-provider';
import type {
  UseQueryOptions,
  QueryObserverResult,
  UseMutationResult,
} from '@tanstack/react-query';
import type {
  TApprovalDecisionRequest,
  TApprovalsResponse,
  TApproval,
} from 'librechat-data-provider';

export const useApprovalsQuery = (
  config?: UseQueryOptions<TApprovalsResponse>,
): QueryObserverResult<TApprovalsResponse> => {
  return useQuery<TApprovalsResponse>([QueryKeys.approvals], () => dataService.getApprovals(), {
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    ...config,
  });
};

export type DecideApprovalParams = {
  approvalId: string;
  payload: TApprovalDecisionRequest;
};

export const useDecideApprovalMutation = (): UseMutationResult<
  TApproval,
  unknown,
  DecideApprovalParams
> => {
  const queryClient = useQueryClient();
  return useMutation(
    ({ approvalId, payload }: DecideApprovalParams) =>
      dataService.decideApproval(approvalId, payload),
    {
      onMutate: async ({ approvalId, payload }) => {
        await queryClient.cancelQueries([QueryKeys.approvals]);
        const previous = queryClient.getQueryData<TApprovalsResponse>([QueryKeys.approvals]);
        queryClient.setQueryData<TApprovalsResponse>([QueryKeys.approvals], (approvals) =>
          (approvals ?? []).map((approval) =>
            approval._id === approvalId ? { ...approval, status: payload.status } : approval,
          ),
        );
        return { previous };
      },
      onError: (_error, _params, context) => {
        const ctx = context as { previous?: TApprovalsResponse } | undefined;
        if (ctx?.previous) {
          queryClient.setQueryData([QueryKeys.approvals], ctx.previous);
        }
      },
      onSettled: () => {
        queryClient.invalidateQueries([QueryKeys.approvals]);
      },
    },
  );
};
