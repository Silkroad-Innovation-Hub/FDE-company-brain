/* Brain */
import { useQuery } from '@tanstack/react-query';
import { QueryKeys, dataService } from 'librechat-data-provider';
import type { UseQueryOptions, QueryObserverResult } from '@tanstack/react-query';
import type { TBrainGraph, TBrainNote } from 'librechat-data-provider';

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
