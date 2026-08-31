/* Brain */
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { QueryKeys, dataService } from 'librechat-data-provider';
import type {
  UseQueryOptions,
  QueryObserverResult,
  UseMutationResult,
} from '@tanstack/react-query';
import type {
  TBrainApprovalsResponse,
  TBrainApprovalDecision,
  TBrainApproval,
  TBrainGraph,
  TBrainNote,
} from 'librechat-data-provider';

export const useBrainGraphQuery = (
  config?: UseQueryOptions<TBrainGraph>,
): QueryObserverResult<TBrainGraph> => {
  return useQuery<TBrainGraph>([QueryKeys.brainGraph], () => dataService.getBrainGraph(), {
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: 60_000,
    ...config,
  });
};

export const useBrainNoteQuery = (
  noteId: string | null,
  config?: UseQueryOptions<TBrainNote>,
): QueryObserverResult<TBrainNote> => {
  return useQuery<TBrainNote>(
    [QueryKeys.brainNote, noteId],
    () => dataService.getBrainNote(noteId ?? ''),
    {
      enabled: noteId != null && noteId.length > 0,
      refetchOnWindowFocus: false,
      staleTime: 60_000,
      ...config,
    },
  );
};

export const useBrainApprovalsQuery = (
  config?: UseQueryOptions<TBrainApprovalsResponse>,
): QueryObserverResult<TBrainApprovalsResponse> => {
  return useQuery<TBrainApprovalsResponse>(
    [QueryKeys.brainApprovals],
    () => dataService.getBrainApprovals(),
    {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      ...config,
    },
  );
};

export type DecideBrainApprovalParams = {
  brainLogId: string;
  decision: TBrainApprovalDecision;
};

/** Approve/reject a proposed memory write; the entry leaves the queue optimistically. */
export const useDecideBrainApprovalMutation = (): UseMutationResult<
  TBrainApproval,
  unknown,
  DecideBrainApprovalParams
> => {
  const queryClient = useQueryClient();
  return useMutation(
    ({ brainLogId, decision }: DecideBrainApprovalParams) =>
      dataService.decideBrainApproval(brainLogId, decision),
    {
      onMutate: async ({ brainLogId }) => {
        await queryClient.cancelQueries([QueryKeys.brainApprovals]);
        const previous = queryClient.getQueryData<TBrainApprovalsResponse>([
          QueryKeys.brainApprovals,
        ]);
        queryClient.setQueryData<TBrainApprovalsResponse>([QueryKeys.brainApprovals], (entries) =>
          (entries ?? []).filter((entry) => entry._id !== brainLogId),
        );
        return { previous };
      },
      onError: (_error, _params, context) => {
        const ctx = context as { previous?: TBrainApprovalsResponse } | undefined;
        if (ctx?.previous) {
          queryClient.setQueryData([QueryKeys.brainApprovals], ctx.previous);
        }
      },
      onSettled: () => {
        queryClient.invalidateQueries([QueryKeys.brainApprovals]);
        queryClient.invalidateQueries([QueryKeys.brainGraph]);
        queryClient.invalidateQueries([QueryKeys.todos]);
        queryClient.invalidateQueries([QueryKeys.guardrailsActivity]);
      },
    },
  );
};
