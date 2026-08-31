import type {
  IAuditLog,
  AuditAction,
  AuditOutcome,
  AuditSeverity,
  AuditMetadata,
  AuditActorInput,
  RecordAuditEntryInput,
  RecordAuditEntryOptions,
} from '@librechat/data-schemas';

export type RecordAuditEntry = (
  input: RecordAuditEntryInput,
  options?: RecordAuditEntryOptions,
) => Promise<IAuditLog | null>;

export interface AuditTarget {
  type: string;
  id?: string;
  name?: string;
}

/**
 * Metadata rule (brief §6 + auditLog schema): ids, domains, counts and
 * booleans only — never addresses, subjects, bodies or prompts.
 */
export interface AuditEvent {
  actor: AuditActorInput;
  target: AuditTarget;
  outcome?: AuditOutcome;
  severity?: AuditSeverity;
  metadata?: AuditMetadata;
}

/** Resolves true when the entry was durably recorded; throws only when `failClosed`. */
export type ChannelAudit = (
  action: AuditAction,
  event: AuditEvent,
  options?: RecordAuditEntryOptions,
) => Promise<boolean>;

export class AuditUnavailableError extends Error {}

export const AGENT_ACTOR: AuditActorInput = { type: 'agent', name: 'silkroad' };
export const SYSTEM_ACTOR: AuditActorInput = { type: 'system', name: 'silkroad' };

export function ownerActor(userId: string, name: string = 'owner'): AuditActorInput {
  return { type: 'user', id: userId, name };
}

/** Audit sink that records nothing — for tests and callers without a recorder. */
export const NOOP_AUDIT: ChannelAudit = async () => false;

export interface ChannelAuditOptions {
  tenantId?: string;
  /** Owner the entry belongs to; stamped into metadata so owner-scoped views include agent/system actors. */
  user?: string;
}

export function createChannelAudit(
  recordAuditEntry: RecordAuditEntry | undefined,
  options: ChannelAuditOptions = {},
): ChannelAudit {
  return async (action, event, writeOptions) => {
    const failClosed = writeOptions?.failClosed === true;
    if (!recordAuditEntry) {
      if (failClosed) {
        throw new AuditUnavailableError(`No audit recorder available for ${action}`);
      }
      return false;
    }
    try {
      const metadata =
        options.user && event.metadata?.user == null
          ? { user: options.user, ...(event.metadata ?? {}) }
          : event.metadata;
      const entry = await recordAuditEntry(
        { action, ...event, metadata, tenantId: options.tenantId },
        writeOptions,
      );
      if (entry == null && failClosed) {
        throw new AuditUnavailableError(`Audit write for ${action} was not durable`);
      }
      return entry != null;
    } catch (error) {
      if (failClosed) {
        throw error;
      }
      return false;
    }
  };
}
