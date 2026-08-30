import type { BrainLogLean, BrainLogResolution, TodoLean } from '@librechat/data-schemas';
import type { BrainGate, BrainSource, TriageResult } from './gate';
import type { BrainNoteMeta } from './vault';
import { loadVault, readBrainNote, writeBrainNote } from './vault';

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
}

const DEFAULT_MAX_ATTEMPTS = 3;
const STALE_PROCESSING_MS = 10 * 60_000;

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

async function distillEntry(
  deps: BrainWorkerDeps,
  entry: BrainLogLean,
  index: BrainNoteMeta[],
): Promise<BrainLogResolution> {
  const source = sourceOf(entry);
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

  const related = (
    await Promise.all(triage.related.map((id) => readBrainNote(deps.vaultPath, id)))
  ).filter((note): note is NonNullable<typeof note> => note != null);
  const distilled = await deps.gate.distill(
    entry.text,
    index,
    related.map((note) => ({ id: note.id, content: note.content })),
    source,
  );

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
  return { status: 'applied', ...proposal };
}

/**
 * Processes one claimed batch. Returns the number of entries handled; 0 means
 * the queue was empty. Failures retry until maxAttempts, then park as failed.
 */
export async function runBrainWorkerOnce(deps: BrainWorkerDeps): Promise<number> {
  if (deps.isPaused && (await deps.isPaused())) {
    return 0;
  }
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
  deps: Pick<BrainWorkerDeps, 'methods' | 'vaultPath'>,
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
    const written = await writeBrainNote(deps.vaultPath, {
      id: entry.noteId as string,
      type: entry.noteType ?? 'note',
      content: entry.noteContent as string,
    });
    if (!written) {
      return deps.methods.resolveBrainLog(brainLogId, {
        status: 'failed',
        reason: `Unsafe note id: ${entry.noteId}`,
      });
    }
  }
  const created = await applyTodoItems(deps.methods, entry.user, todoItems);
  return deps.methods.resolveBrainLog(brainLogId, { status: 'applied', todoItems: created });
}
