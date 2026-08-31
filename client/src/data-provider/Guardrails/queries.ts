/* Guardrails */
import { useQuery } from '@tanstack/react-query';
import { QueryKeys, dataService } from 'librechat-data-provider';
import type { UseQueryOptions, QueryObserverResult } from '@tanstack/react-query';
import type { TGuardrailsActivity, TGuardrailsStatus } from 'librechat-data-provider';

const STATUS_REFETCH_MS = 60_000;

export const useGuardrailsStatusQuery = (
  config?: UseQueryOptions<TGuardrailsStatus>,
): QueryObserverResult<TGuardrailsStatus> => {
  return useQuery<TGuardrailsStatus>(
    [QueryKeys.guardrailsStatus],
    () => dataService.getGuardrailsStatus(),
    {
      refetchInterval: STATUS_REFETCH_MS,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      ...config,
    },
  );
};

export const useGuardrailsActivityQuery = (
  limit: number,
  config?: UseQueryOptions<TGuardrailsActivity>,
): QueryObserverResult<TGuardrailsActivity> => {
  return useQuery<TGuardrailsActivity>(
    [QueryKeys.guardrailsActivity, limit],
    () => dataService.getGuardrailsActivity(limit),
    {
      keepPreviousData: true,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      ...config,
    },
  );
};
