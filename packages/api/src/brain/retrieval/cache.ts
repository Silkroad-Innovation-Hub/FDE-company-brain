import type { BrainVectorLean, BrainVectorListOptions } from '@librechat/data-schemas';
import type { BrainHitKind } from './types';

export interface CachedMeta {
  key: string;
  kind: BrainHitKind;
  refId: string;
  chunk: number;
  title: string;
  text: string;
  surface?: string;
  sender?: string;
  sourceAt?: Date;
  updatedAt: Date;
}

export interface CacheHit {
  meta: CachedMeta;
  score: number;
}

export interface VectorCacheDeps {
  listBrainVectors: (user: string, options?: BrainVectorListOptions) => Promise<BrainVectorLean[]>;
  logDays: number;
  maxVectors: number;
  /** Full reload cadence so deletions made by other processes are eventually seen. */
  fullReloadMs?: number;
  now?: () => Date;
}

export interface VectorCache {
  loadOrRefresh: (user: string) => Promise<number>;
  topK: (
    user: string,
    query: Float32Array,
    k: number,
    filter?: (meta: CachedMeta) => boolean,
  ) => CacheHit[];
  forget: (user: string, kind: BrainHitKind, refId: string, keepChunks?: number[]) => number;
  size: (user: string) => number;
  reset: (user?: string) => void;
}

interface UserIndex {
  rows: Float32Array[];
  meta: CachedMeta[];
  slots: Map<string, number>;
  cursor?: Date;
  loadedAt?: Date;
}

const DAY_MS = 86_400_000;
const DEFAULT_FULL_RELOAD_MS = 10 * 60_000;

export function vectorKey(kind: BrainHitKind, refId: string, chunk: number): string {
  return `${kind}:${refId}:${chunk}`;
}

export function normalize(vector: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < vector.length; i++) {
    sum += vector[i] * vector[i];
  }
  const norm = Math.sqrt(sum);
  if (norm === 0) {
    return vector;
  }
  const out = new Float32Array(vector.length);
  for (let i = 0; i < vector.length; i++) {
    out[i] = vector[i] / norm;
  }
  return out;
}

/** Copies into an aligned buffer first — BSON binaries are not guaranteed 4-byte aligned. */
export function bufferToVector(buffer: Buffer, dims: number): Float32Array {
  const aligned = new Uint8Array(dims * Float32Array.BYTES_PER_ELEMENT);
  aligned.set(buffer.subarray(0, aligned.byteLength));
  return new Float32Array(aligned.buffer, 0, dims);
}

function dot(a: Float32Array, b: Float32Array): number {
  const length = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

function toMeta(row: BrainVectorLean): CachedMeta {
  return {
    key: vectorKey(row.kind, row.refId, row.chunk),
    kind: row.kind,
    refId: row.refId,
    chunk: row.chunk,
    title: row.title,
    text: row.text,
    surface: row.surface,
    sender: row.sender,
    sourceAt: row.sourceAt ? new Date(row.sourceAt) : undefined,
    updatedAt: row.updatedAt ? new Date(row.updatedAt) : new Date(0),
  };
}

function removeAt(index: UserIndex, slot: number): void {
  const last = index.rows.length - 1;
  index.slots.delete(index.meta[slot].key);
  if (slot !== last) {
    index.rows[slot] = index.rows[last];
    index.meta[slot] = index.meta[last];
    index.slots.set(index.meta[slot].key, slot);
  }
  index.rows.pop();
  index.meta.pop();
}

/**
 * Per-user in-memory matrix of unit vectors with incremental refresh from the
 * store. Cosine similarity is a dot product because rows are normalised on
 * insert. Bounded by `maxVectors`; oldest raw-log rows are evicted first.
 */
export function createVectorCache(deps: VectorCacheDeps): VectorCache {
  const users = new Map<string, UserIndex>();
  const fullReloadMs = deps.fullReloadMs ?? DEFAULT_FULL_RELOAD_MS;
  const now = deps.now ?? (() => new Date());

  function indexFor(user: string): UserIndex {
    const existing = users.get(user);
    if (existing) {
      return existing;
    }
    const created: UserIndex = { rows: [], meta: [], slots: new Map() };
    users.set(user, created);
    return created;
  }

  function upsertRow(index: UserIndex, row: BrainVectorLean): void {
    const meta = toMeta(row);
    const vector = normalize(bufferToVector(row.vector, row.dims));
    const slot = index.slots.get(meta.key);
    if (slot != null) {
      index.rows[slot] = vector;
      index.meta[slot] = meta;
      return;
    }
    index.slots.set(meta.key, index.rows.length);
    index.rows.push(vector);
    index.meta.push(meta);
  }

  function evict(index: UserIndex, windowStart: Date): void {
    for (let slot = index.meta.length - 1; slot >= 0; slot--) {
      const meta = index.meta[slot];
      if (meta.kind === 'log' && meta.sourceAt && meta.sourceAt < windowStart) {
        removeAt(index, slot);
      }
    }
    if (index.rows.length <= deps.maxVectors) {
      return;
    }
    const logSlots = index.meta
      .map((meta, slot) => ({ meta, slot }))
      .filter((entry) => entry.meta.kind === 'log')
      .sort((a, b) => (a.meta.sourceAt?.getTime() ?? 0) - (b.meta.sourceAt?.getTime() ?? 0));
    const excess = index.rows.length - deps.maxVectors;
    const victims = logSlots
      .slice(0, excess)
      .map((entry) => entry.meta.key)
      .map((key) => index.slots.get(key))
      .filter((slot): slot is number => slot != null)
      .sort((a, b) => b - a);
    for (const slot of victims) {
      removeAt(index, slot);
    }
  }

  async function loadOrRefresh(user: string): Promise<number> {
    const current = now();
    const stale =
      users.get(user)?.loadedAt != null &&
      current.getTime() - (users.get(user)?.loadedAt?.getTime() ?? 0) > fullReloadMs;
    if (stale) {
      users.delete(user);
    }
    const index = indexFor(user);
    const windowStart = new Date(current.getTime() - deps.logDays * DAY_MS);
    const rows = await deps.listBrainVectors(user, {
      updatedAfter: index.cursor,
      sourceAfter: windowStart,
    });
    for (const row of rows) {
      upsertRow(index, row);
      const updatedAt = row.updatedAt ? new Date(row.updatedAt) : undefined;
      if (updatedAt && (!index.cursor || updatedAt > index.cursor)) {
        index.cursor = updatedAt;
      }
    }
    if (!index.loadedAt) {
      index.loadedAt = current;
    }
    evict(index, windowStart);
    return rows.length;
  }

  function topK(
    user: string,
    query: Float32Array,
    k: number,
    filter?: (meta: CachedMeta) => boolean,
  ): CacheHit[] {
    const index = users.get(user);
    if (!index || k <= 0) {
      return [];
    }
    const unit = normalize(query);
    const hits: CacheHit[] = [];
    for (let slot = 0; slot < index.rows.length; slot++) {
      const meta = index.meta[slot];
      if (filter && !filter(meta)) {
        continue;
      }
      hits.push({ meta, score: dot(unit, index.rows[slot]) });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, k);
  }

  function forget(user: string, kind: BrainHitKind, refId: string, keepChunks?: number[]): number {
    const index = users.get(user);
    if (!index) {
      return 0;
    }
    const keep = new Set(keepChunks ?? []);
    let removed = 0;
    for (let slot = index.meta.length - 1; slot >= 0; slot--) {
      const meta = index.meta[slot];
      if (meta.kind === kind && meta.refId === refId && !keep.has(meta.chunk)) {
        removeAt(index, slot);
        removed += 1;
      }
    }
    return removed;
  }

  function size(user: string): number {
    return users.get(user)?.rows.length ?? 0;
  }

  function reset(user?: string): void {
    if (user) {
      users.delete(user);
      return;
    }
    users.clear();
  }

  return { loadOrRefresh, topK, forget, size, reset };
}
