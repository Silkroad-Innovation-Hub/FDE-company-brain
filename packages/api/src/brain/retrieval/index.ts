import type {
  BrainLogLean,
  BrainVectorLean,
  BrainVectorUpsert,
  BrainVectorListOptions,
} from '@librechat/data-schemas';
import type {
  BrainRetriever,
  BrainHit,
  BrainHitKind,
  BrainSearchOptions,
  BrainSyncResult,
} from './types';
import type { BrainChunk } from './chunk';
import type { CachedMeta } from './cache';
import type { BrainNote } from '~/brain/vault';
import type { BrainEmbedFn } from '~/brain/openai';
import { loadVault, readBrainNote } from '~/brain/vault';
import { createVectorCache } from './cache';
import { noteChunks, logChunk } from './chunk';

export * from './types';
export * from './chunk';
export * from './cache';

export interface BrainRetrieverMethods {
  upsertBrainVectors: (user: string, units: BrainVectorUpsert[]) => Promise<number>;
  listBrainVectors: (user: string, options?: BrainVectorListOptions) => Promise<BrainVectorLean[]>;
  listBrainVectorHashes: (
    user: string,
    kind: BrainHitKind,
    refId: string,
  ) => Promise<Array<{ chunk: number; hash: string }>>;
  deleteBrainVectors: (
    user: string,
    kind: BrainHitKind,
    refId: string,
    keepChunks?: number[],
  ) => Promise<number>;
  listBrainLogsForEmbedding: (
    user: string,
    options?: { limit?: number; sinceDays?: number },
  ) => Promise<BrainLogLean[]>;
  markBrainLogsEmbedded: (brainLogIds: string[]) => Promise<number>;
}

export interface BrainRetrieverLogger {
  info: (message: string) => void;
  warn: (message: string) => void;
}

export interface BrainRetrieverOptions {
  logDays?: number;
  maxVectors?: number;
  minScore?: number;
  embedModel?: string;
  now?: () => Date;
}

export interface BrainRetrieverDeps {
  methods: BrainRetrieverMethods;
  embed: BrainEmbedFn;
  logger: BrainRetrieverLogger;
  options?: BrainRetrieverOptions;
}

const DEFAULT_K = 5;
const DEFAULT_LOG_DAYS = 90;
const DEFAULT_MAX_VECTORS = 20_000;
const DEFAULT_MIN_SCORE = 0.25;
const DEFAULT_EMBED_MODEL_LABEL = 'text-embedding-3-small';
const LAZY_SYNC_LIMIT = 50;
const CANDIDATE_MULTIPLIER = 3;
const LEXICAL_BONUS_PER_TOKEN = 0.05;
const LEXICAL_BONUS_CAP = 0.15;
const DAY_MS = 86_400_000;

function tokenize(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z0-9$][a-z0-9$-]{2,}/g) ?? []);
}

function lexicalBonus(queryTokens: Set<string>, meta: CachedMeta): number {
  const haystack = tokenize(`${meta.title} ${meta.sender ?? ''}`);
  let bonus = 0;
  for (const token of queryTokens) {
    if (haystack.has(token)) {
      bonus += LEXICAL_BONUS_PER_TOKEN;
    }
  }
  return Math.min(bonus, LEXICAL_BONUS_CAP);
}

function toVectorBuffer(vector: Float32Array): Buffer {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
}

function toHit(meta: CachedMeta, score: number): BrainHit {
  return {
    kind: meta.kind,
    refId: meta.refId,
    title: meta.title,
    text: meta.text,
    score,
    surface: meta.surface,
    sender: meta.sender,
    sourceAt: meta.sourceAt,
  };
}

/** In-process retriever over `brainvectors` — see context/unification.md §1. */
export function createBrainRetriever(deps: BrainRetrieverDeps): BrainRetriever {
  const logDays = deps.options?.logDays ?? DEFAULT_LOG_DAYS;
  const minScore = deps.options?.minScore ?? DEFAULT_MIN_SCORE;
  const embedModel = deps.options?.embedModel ?? DEFAULT_EMBED_MODEL_LABEL;
  const now = deps.options?.now ?? (() => new Date());
  const cache = createVectorCache({
    listBrainVectors: deps.methods.listBrainVectors,
    logDays,
    maxVectors: deps.options?.maxVectors ?? DEFAULT_MAX_VECTORS,
    now,
  });

  async function embedChunks(chunks: BrainChunk[]): Promise<Float32Array[]> {
    return deps.embed(chunks.map((chunk) => chunk.text));
  }

  async function indexNote(user: string, note: BrainNote): Promise<BrainSyncResult> {
    const chunks = noteChunks(note);
    const existing = new Map(
      (await deps.methods.listBrainVectorHashes(user, 'note', note.id)).map((row) => [
        row.chunk,
        row.hash,
      ]),
    );
    const changed = chunks.filter((chunk) => existing.get(chunk.chunk) !== chunk.hash);
    const keep = chunks.map((chunk) => chunk.chunk);
    const removed =
      existing.size > keep.length || [...existing.keys()].some((chunk) => !keep.includes(chunk))
        ? await deps.methods.deleteBrainVectors(user, 'note', note.id, keep)
        : 0;
    cache.forget(user, 'note', note.id, keep);
    if (changed.length === 0) {
      return { indexed: 0, unchanged: chunks.length, removed };
    }
    const vectors = await embedChunks(changed);
    await deps.methods.upsertBrainVectors(
      user,
      changed.map((chunk, i) => ({
        kind: 'note' as const,
        refId: note.id,
        chunk: chunk.chunk,
        title: note.title,
        text: chunk.text,
        hash: chunk.hash,
        embedModel,
        dims: vectors[i].length,
        vector: toVectorBuffer(vectors[i]),
      })),
    );
    return { indexed: changed.length, unchanged: chunks.length - changed.length, removed };
  }

  async function removeNote(user: string, noteId: string): Promise<number> {
    cache.forget(user, 'note', noteId);
    return deps.methods.deleteBrainVectors(user, 'note', noteId);
  }

  async function indexLogEntries(user: string, entries: BrainLogLean[]): Promise<number> {
    const usable = entries.filter((entry) => entry.text.trim().length > 0);
    if (usable.length === 0) {
      return 0;
    }
    const chunks = usable.map(logChunk);
    const vectors = await embedChunks(chunks);
    await deps.methods.upsertBrainVectors(
      user,
      usable.map((entry, i) => ({
        kind: 'log' as const,
        refId: String(entry._id),
        chunk: 0,
        title: chunks[i].title,
        text: chunks[i].text,
        hash: chunks[i].hash,
        embedModel,
        dims: vectors[i].length,
        vector: toVectorBuffer(vectors[i]),
        surface: entry.surface,
        sender: entry.sender,
        sourceAt: entry.createdAt ? new Date(entry.createdAt) : now(),
      })),
    );
    await deps.methods.markBrainLogsEmbedded(entries.map((entry) => String(entry._id)));
    return usable.length;
  }

  async function syncLog(user: string, options?: { limit?: number }): Promise<number> {
    const pending = await deps.methods.listBrainLogsForEmbedding(user, {
      limit: options?.limit,
      sinceDays: logDays,
    });
    if (pending.length === 0) {
      return 0;
    }
    return indexLogEntries(user, pending);
  }

  async function syncVault(user: string, vaultPath: string): Promise<BrainSyncResult> {
    const metas = await loadVault(vaultPath);
    const notes = await Promise.all(metas.map((meta) => readBrainNote(vaultPath, meta.id)));
    const totals: BrainSyncResult = { indexed: 0, unchanged: 0, removed: 0 };
    for (const note of notes) {
      if (!note) {
        continue;
      }
      const result = await indexNote(user, note);
      totals.indexed += result.indexed;
      totals.unchanged += result.unchanged;
      totals.removed += result.removed;
    }
    return totals;
  }

  async function search(
    user: string,
    query: string,
    options: BrainSearchOptions = {},
  ): Promise<BrainHit[]> {
    const k = options.k ?? DEFAULT_K;
    const sources = new Set<BrainHitKind>(options.sources ?? ['note', 'log']);
    const windowStart = new Date(now().getTime() - (options.sinceDays ?? logDays) * DAY_MS);
    const threshold = options.minScore ?? minScore;
    try {
      await syncLog(user, { limit: LAZY_SYNC_LIMIT });
    } catch (error) {
      deps.logger.warn(
        `brain: lazy log sync failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const [queryVector] = await deps.embed([query]);
    await cache.loadOrRefresh(user);
    const queryTokens = tokenize(query);
    const candidates = cache.topK(user, queryVector, k * CANDIDATE_MULTIPLIER, (meta) => {
      if (!sources.has(meta.kind)) {
        return false;
      }
      return meta.kind === 'note' || !meta.sourceAt || meta.sourceAt >= windowStart;
    });
    const best = new Map<string, BrainHit>();
    for (const candidate of candidates) {
      const score = candidate.score + lexicalBonus(queryTokens, candidate.meta);
      if (score < threshold) {
        continue;
      }
      const key = `${candidate.meta.kind}:${candidate.meta.refId}`;
      const current = best.get(key);
      if (!current || score > current.score) {
        best.set(key, toHit(candidate.meta, score));
      }
    }
    return [...best.values()].sort((a, b) => b.score - a.score).slice(0, k);
  }

  return { search, indexNote, removeNote, indexLogEntries, syncVault, syncLog };
}
