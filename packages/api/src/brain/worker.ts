import type { BrainLogLean, BrainLogResolution, TodoLean } from '@librechat/data-schemas';
import type { BrainGate, BrainSource, TriageResult, DistillNote } from './gate';
import type { BrainRetriever, BrainHit } from './retrieval/types';
import type { BrainNoteMeta } from './vault';
import { loadVault, readBrainNote, writeBrainNote, vaultStamp } from './vault';

export interface BrainWorkerLogger {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string, error?: unknown) => void;
}

export interface BrainWorkerMethods {
  claimPendingBrainLogs: (options?: {
    limit?: number;
    quietMs?: number;
    maxAttempts?: number;
  }) => Promise<BrainLogLean[]>;
  resolveBrainLog: (
    brainLogId: string,
    resolution: BrainLogResolution,
  ) => Promise<BrainLogLean | null>;
  requeueStaleBrainLogs: (staleMs: number) => Promise<number>;
  getBrainLog: (brainLogId: string) => Promise<BrainLogLean | null>;
  getTodos: (user: string) => Promise<TodoLean[]>;
  createTodo: (user: string, data: { text: string; position?: number }) => Promise<TodoLean>;
}

export interface BrainWorkerDeps {
  methods: BrainWorkerMethods;
  gate: BrainGate;
  vaultPath: string;
  approvalRequired: boolean;
  logger: BrainWorkerLogger;
  claim?: { limit?: number; quietMs?: number; maxAttempts?: number };
  maxAttempts?: number;
  /** Kill switch: when it resolves true the worker leaves the queue untouched. */
  isPaused?: () => Promise<boolean>;
  /** Retrieval service: dedup before model calls, related notes for distill, index after writes. */
  retriever?: BrainRetriever;
  /** Owner user id whose raw log and vault the retriever keeps in sync. */
  owner?: string;
  /** Cosine score at which a raw-log hit counts as a near-duplicate (default 0.95). */
  dedupThreshold?: number;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_DEDUP_THRESHOLD = 0.95;
const STALE_PROCESSING_MS = 10 * 60_000;
const SEARCH_K = 5;
const RELATED_NOTES = 3;
const LOG_SYNC_LIMIT = 200;

const syncedVaultStamps = new Map<string, string>();

export function sourceOf(entry: BrainLogLean): BrainSource {
  return {
    surface: entry.surface,
    direction: entry.direction,
    sender: entry.sender,
    subject: entry.subject,
  };
}

/**
 * Writes the action items triage found, skipping ones already open. Returns
 * the texts actually created so the log entry records them.
 */
export async function applyTodoItems(
  methods: Pick<BrainWorkerMethods, 'getTodos' | 'createTodo'>,
  user: string,
  items: string[],
): Promise<string[]> {
  if (items.length === 0) {
    return [];
  }
  const existing = await methods.getTodos(user);
  const open = new Set(
    existing.filter((todo) => !todo.done).map((todo) => todo.text.trim().toLowerCase()),
  );
  let position = existing.reduce((max, todo) => Math.max(max, todo.position), 0);
  const created: string[] = [];
  for (const text of items) {
    if (open.has(text.toLowerCase())) {
      continue;
    }
    position += 1;
    await methods.createTodo(user, { text, position });
    open.add(text.toLowerCase());
    created.push(text);
  }
  return created;
}

async function resolveTodos(
  deps: BrainWorkerDeps,
  entry: BrainLogLean,
  triage: TriageResult,
): Promise<Pick<BrainLogResolution, 'todoItems'>> {
  if (triage.actionItems.length === 0) {
    return {};
  }
  if (deps.approvalRequired) {
    return { todoItems: triage.actionItems };
  }
  const created = await applyTodoItems(deps.methods, entry.user, triage.actionItems);
  return created.length > 0 ? { todoItems: created } : {};
}

function isSettledKnown(entry: BrainLogLean | null): boolean {
  if (!entry) {
    return false;
  }
  return entry.status === 'applied' || (entry.status === 'skipped' && entry.outcome === 'known');
}

/** A near-identical, already-settled raw-log entry means nothing new to remember. */
async function findNearDuplicate(
  deps: BrainWorkerDeps,
  entry: BrainLogLean,
  hits: BrainHit[],
): Promise<{ messageId: string; score: number } | null> {
  const threshold = deps.dedupThreshold ?? DEFAULT_DEDUP_THRESHOLD;
  const entryId = String(entry._id);
  const candidate = hits.find(
    (hit) => hit.kind === 'log' && hit.refId !== entryId && hit.score >= threshold,
  );
  if (!candidate) {
    return null;
  }
  const original = await deps.methods.getBrainLog(candidate.refId);
  if (!isSettledKnown(original)) {
    return null;
  }
  return { messageId: original?.messageId ?? candidate.refId, score: candidate.score };
}

async function relatedNotes(
  deps: BrainWorkerDeps,
  hits: BrainHit[] | null,
  triage: TriageResult,
): Promise<DistillNote[]> {
  const ids = hits
    ? hits
        .filter((hit) => hit.kind === 'note')
        .slice(0, RELATED_NOTES)
        .map((hit) => hit.refId)
    : triage.related;
  const notes = await Promise.all(ids.map((id) => readBrainNote(deps.vaultPath, id)));
  return notes
    .filter((note): note is NonNullable<typeof note> => note != null)
    .map((note) => ({ id: note.id, content: note.content }));
}

async function indexWrittenNote(
  deps: Pick<BrainWorkerDeps, 'retriever' | 'logger'>,
  user: string,
  note: { id: string; type: string; content: string },
): Promise<void> {
  if (!deps.retriever) {
    return;
  }
  try {
    await deps.retriever.indexNote(user, {
      id: note.id,
      title: note.id,
      type: note.type,
      tags: [],
      content: note.content,
    });
  } catch (error) {
    deps.logger.warn(
      `brain: indexing ${note.id} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function distillEntry(
  deps: BrainWorkerDeps,
  entry: BrainLogLean,
  index: BrainNoteMeta[],
): Promise<BrainLogResolution> {
  const source = sourceOf(entry);
  const hits = deps.retriever
    ? await deps.retriever.search(entry.user, entry.text, { k: SEARCH_K })
    : null;
  if (hits) {
    const duplicate = await findNearDuplicate(deps, entry, hits);
    if (duplicate) {
      return {
        status: 'skipped',
        outcome: 'known',
        reason: `near-duplicate of ${duplicate.messageId} (${duplicate.score.toFixed(2)})`,
      };
    }
  }

  const triage = await deps.gate.triage(entry.text, index, source);
  if (triage.injection) {
    return {
      status: 'skipped',
      outcome: 'flagged',
      reason: triage.reason || 'Content contains instructions addressed to an AI',
    };
  }

  const todos = await resolveTodos(deps, entry, triage);
  const pendingTodos = deps.approvalRequired && todos.todoItems != null;

  if (triage.verdict === 'ephemeral') {
    return {
      status: pendingTodos ? 'awaiting_approval' : 'skipped',
      outcome: 'ephemeral',
      reason: triage.reason,
      ...todos,
    };
  }

  const related = await relatedNotes(deps, hits, triage);
  const distilled = await deps.gate.distill(entry.text, index, related, source);

  if (distilled.action === 'known') {
    return {
      status: pendingTodos ? 'awaiting_approval' : 'skipped',
      outcome: 'known',
      reason: distilled.reason,
      ...todos,
    };
  }

  const exists = index.some((note) => note.id === distilled.noteId);
  const outcome = exists ? 'merge' : 'create';
  const proposal = {
    outcome,
    noteId: distilled.noteId,
    noteType: distilled.noteType,
    noteContent: distilled.noteContent,
    reason: distilled.reason,
    ...todos,
  } as const;

  if (deps.approvalRequired) {
    return { status: 'awaiting_approval', ...proposal };
  }

  const written = await writeBrainNote(deps.vaultPath, {
    id: distilled.noteId,
    type: distilled.noteType,
    content: distilled.noteContent,
  });
  if (!written) {
    return { status: 'failed', ...proposal, reason: `Unsafe note id: ${distilled.noteId}` };
  }
  await indexWrittenNote(deps, entry.user, {
    id: distilled.noteId,
    type: distilled.noteType,
    content: distilled.noteContent,
  });
  return { status: 'applied', ...proposal };
}

/**
 * Keeps the retrieval index current: embeds new raw-log entries every tick and
 * re-indexes the vault only when its files changed since the last sync.
 */
export async function syncRetriever(deps: BrainWorkerDeps): Promise<void> {
  if (!deps.retriever || !deps.owner) {
    return;
  }
  try {
    const embedded = await deps.retriever.syncLog(deps.owner, { limit: LOG_SYNC_LIMIT });
    if (embedded > 0) {
      deps.logger.info(`brain: embedded ${embedded} raw-log entries`);
    }
    const stamp = await vaultStamp(deps.vaultPath);
    if (syncedVaultStamps.get(deps.vaultPath) === stamp) {
      return;
    }
    const result = await deps.retriever.syncVault(deps.owner, deps.vaultPath);
    syncedVaultStamps.set(deps.vaultPath, stamp);
    if (result.indexed > 0 || result.removed > 0) {
      deps.logger.info(
        `brain: vault index updated (${result.indexed} chunks embedded, ${result.unchanged} unchanged, ${result.removed} removed)`,
      );
    }
  } catch (error) {
    deps.logger.error('brain: retrieval sync failed', error);
  }
}

/**
 * Processes one claimed batch. Returns the number of entries handled; 0 means
 * the queue was empty. Failures retry until maxAttempts, then park as failed.
 */
export async function runBrainWorkerOnce(deps: BrainWorkerDeps): Promise<number> {
  if (deps.isPaused && (await deps.isPaused())) {
    return 0;
  }
  await syncRetriever(deps);
  await deps.methods.requeueStaleBrainLogs(STALE_PROCESSING_MS);
  const maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const entries = await deps.methods.claimPendingBrainLogs({ maxAttempts, ...deps.claim });
  if (entries.length === 0) {
    return 0;
  }
  const index = await loadVault(deps.vaultPath);
  for (const entry of entries) {
    try {
      const resolution = await distillEntry(deps, entry, index);
      await deps.methods.resolveBrainLog(String(entry._id), resolution);
      deps.logger.info(
        `brain: ${resolution.status}${resolution.outcome ? ` (${resolution.outcome})` : ''} — ${entry.messageId}`,
      );
    } catch (error) {
      const parked = entry.attempts >= maxAttempts;
      await deps.methods.resolveBrainLog(String(entry._id), {
        status: parked ? 'failed' : 'pending',
        reason: error instanceof Error ? error.message : 'Unknown distillation error',
      });
      deps.logger.error(`brain: distillation ${parked ? 'failed' : 'will retry'}`, error);
    }
  }
  return entries.length;
}

export interface BrainWorkerHandle {
  stop: () => void;
}

export function startBrainWorker(
  deps: BrainWorkerDeps & { intervalMs: number },
): BrainWorkerHandle {
  let running = false;
  const tick = async () => {
    if (running) {
      return;
    }
    running = true;
    try {
      let processed: number;
      do {
        processed = await runBrainWorkerOnce(deps);
      } while (processed > 0);
    } catch (error) {
      deps.logger.error('brain: worker cycle crashed', error);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, deps.intervalMs);
  void tick();
  return {
    stop: () => clearInterval(timer),
  };
}

/**
 * Applies an approved memory write — the note proposal and/or the extracted
 * to-dos — to the vault and to-do stack. Used by the approval route; returns
 * the updated entry, or null when the entry is not awaiting approval.
 */
export async function applyBrainApproval(
  deps: Pick<BrainWorkerDeps, 'methods' | 'vaultPath'> &
    Partial<Pick<BrainWorkerDeps, 'retriever' | 'logger'>>,
  brainLogId: string,
): Promise<BrainLogLean | null> {
  const entry = await deps.methods.getBrainLog(brainLogId);
  if (!entry || entry.status !== 'awaiting_approval') {
    return null;
  }
  const hasNote = Boolean(entry.noteId && entry.noteContent);
  const todoItems = entry.todoItems ?? [];
  if (!hasNote && todoItems.length === 0) {
    return null;
  }
  if (hasNote) {
    const note = {
      id: entry.noteId as string,
      type: entry.noteType ?? 'note',
      content: entry.noteContent as string,
    };
    const written = await writeBrainNote(deps.vaultPath, note);
    if (!written) {
      return deps.methods.resolveBrainLog(brainLogId, {
        status: 'failed',
        reason: `Unsafe note id: ${entry.noteId}`,
      });
    }
    await indexWrittenNote(
      {
        retriever: deps.retriever,
        logger: deps.logger ?? { info: () => {}, warn: () => {}, error: () => {} },
      },
      entry.user,
      note,
    );
  }
  const created = await applyTodoItems(deps.methods, entry.user, todoItems);
  return deps.methods.resolveBrainLog(brainLogId, { status: 'applied', todoItems: created });
}
