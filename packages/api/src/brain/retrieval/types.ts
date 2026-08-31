import type { BrainLogLean } from '@librechat/data-schemas';
import type { BrainNote } from '~/brain/vault';

export type BrainHitKind = 'note' | 'log';

export interface BrainHit {
  kind: BrainHitKind;
  /** Note id (title) for notes; BrainLog `_id` for log entries. */
  refId: string;
  title: string;
  text: string;
  /** Cosine similarity plus lexical bonus, higher is better; 1.0 is an exact match. */
  score: number;
  surface?: string;
  sender?: string;
  sourceAt?: Date;
}

export interface BrainSearchOptions {
  k?: number;
  sources?: BrainHitKind[];
  /** Raw-log window in days; notes are always in scope. */
  sinceDays?: number;
  /** Minimum score to include a hit. */
  minScore?: number;
}

export interface BrainSyncResult {
  indexed: number;
  unchanged: number;
  removed: number;
}

/**
 * The one retrieval contract every consumer uses — the `brain_search` tool,
 * the channel gateway, and the distiller's dedup step. The in-process
 * implementation lives in `./index.ts`; Silkroad core swaps in pgvector behind
 * the same interface (context/unification.md §1.6).
 */
export interface BrainRetriever {
  search: (user: string, query: string, options?: BrainSearchOptions) => Promise<BrainHit[]>;
  indexNote: (user: string, note: BrainNote) => Promise<BrainSyncResult>;
  removeNote: (user: string, noteId: string) => Promise<number>;
  indexLogEntries: (user: string, entries: BrainLogLean[]) => Promise<number>;
  syncVault: (user: string, vaultPath: string) => Promise<BrainSyncResult>;
  syncLog: (user: string, options?: { limit?: number }) => Promise<number>;
}
