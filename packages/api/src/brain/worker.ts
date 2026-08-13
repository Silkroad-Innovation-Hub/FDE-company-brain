import type { BrainLogLean, BrainLogResolution } from '@librechat/data-schemas';
import type { BrainNoteMeta } from './vault';
import type { BrainGate } from './gate';
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
}

export interface BrainWorkerDeps {
  methods: BrainWorkerMethods;
  gate: BrainGate;
  vaultPath: string;
  approvalRequired: boolean;
  logger: BrainWorkerLogger;
  claim?: { limit?: number; quietMs?: number; maxAttempts?: number };
  maxAttempts?: number;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const STALE_PROCESSING_MS = 10 * 60_000;

async function distillEntry(
  deps: BrainWorkerDeps,
  entry: BrainLogLean,
  index: BrainNoteMeta[],
): Promise<BrainLogResolution> {
  const triage = await deps.gate.triage(entry.text, index);
  if (triage.verdict === 'ephemeral') {
    return { status: 'skipped', outcome: 'ephemeral', reason: triage.reason };
  }

  const related = (
    await Promise.all(triage.related.map((id) => readBrainNote(deps.vaultPath, id)))
  ).filter((note): note is NonNullable<typeof note> => note != null);
  const distilled = await deps.gate.distill(
    entry.text,
    index,
    related.map((note) => ({ id: note.id, content: note.content })),
  );

  if (distilled.action === 'known') {
    return { status: 'skipped', outcome: 'known', reason: distilled.reason };
  }

  const exists = index.some((note) => note.id === distilled.noteId);
  const outcome = exists ? 'merge' : 'create';
  const proposal = {
    outcome,
    noteId: distilled.noteId,
    noteType: distilled.noteType,
    noteContent: distilled.noteContent,
    reason: distilled.reason,
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
 * Applies an approved memory write to the vault. Used by the approval route;
 * returns the updated entry, or null when the entry is not awaiting approval.
 */
export async function applyBrainApproval(
  deps: Pick<BrainWorkerDeps, 'methods' | 'vaultPath'>,
  brainLogId: string,
): Promise<BrainLogLean | null> {
  const entry = await deps.methods.getBrainLog(brainLogId);
  if (!entry || entry.status !== 'awaiting_approval' || !entry.noteId || !entry.noteContent) {
    return null;
  }
  const written = await writeBrainNote(deps.vaultPath, {
    id: entry.noteId,
    type: entry.noteType ?? 'note',
    content: entry.noteContent,
  });
  if (!written) {
    return deps.methods.resolveBrainLog(brainLogId, {
      status: 'failed',
      reason: `Unsafe note id: ${entry.noteId}`,
    });
  }
  return deps.methods.resolveBrainLog(brainLogId, { status: 'applied' });
}
