import type { ApprovalLean, AuditActorInput } from '@librechat/data-schemas';
import type { Types } from 'mongoose';
import type { DraftPolicy } from './policy';
import type { ChannelAudit } from './audit';
import { RecipientNotAllowedError, domainOf } from './policy';

/** The slice of the Gmail client the approval decision needs. */
export interface DraftMailer {
  sendDraft: (draftId: string) => Promise<unknown>;
  deleteDraft: (draftId: string) => Promise<void>;
  getDraftRecipients: (draftId: string) => Promise<{ to: string[]; cc: string[] }>;
}

export interface DraftDecisionDeps {
  mailer: DraftMailer | null;
  policy: DraftPolicy;
  audit: ChannelAudit;
  /** Who decided — the owner for route decisions. */
  actor: AuditActorInput;
}

export type DraftDecisionOutcome = 'sent' | 'deleted' | 'none';

export type DecidedApproval = Pick<ApprovalLean, 'kind' | 'status' | 'payload'> & {
  _id?: Types.ObjectId | string;
};

/**
 * Executes the side effect of a decided email approval: an approved draft is
 * sent, a denied draft is deleted. Approvals without a draft are inert — the
 * decision itself is the whole action. This is the one place agent-drafted
 * mail can leave the account (brief §6: outbound = draft + approval), so the
 * recipients are re-checked against the allowlist and the send is audited
 * fail-closed *before* it happens: no durable audit record, no mail.
 */
export async function applyDraftDecision(
  deps: DraftDecisionDeps,
  approval: DecidedApproval,
): Promise<DraftDecisionOutcome> {
  const draftId = approval.payload?.draftId;
  if (approval.kind !== 'email' || !draftId) {
    return 'none';
  }
  if (!deps.mailer) {
    throw new Error('Email approval has a draft but no Gmail credentials are configured');
  }
  const approvalId = approval._id == null ? undefined : String(approval._id);
  if (approval.status === 'approved') {
    return sendApproved(deps, deps.mailer, draftId, approvalId);
  }
  if (approval.status === 'denied') {
    await deps.mailer.deleteDraft(draftId);
    await deps.audit('channel.draft_deleted', {
      actor: deps.actor,
      target: { type: 'draft', id: draftId },
      metadata: { approvalId: approvalId ?? null },
    });
    return 'deleted';
  }
  return 'none';
}

async function sendApproved(
  deps: DraftDecisionDeps,
  mailer: DraftMailer,
  draftId: string,
  approvalId: string | undefined,
): Promise<DraftDecisionOutcome> {
  const recipients = await mailer.getDraftRecipients(draftId);
  try {
    deps.policy.assertRecipientsAllowed(recipients);
  } catch (error) {
    if (error instanceof RecipientNotAllowedError) {
      await deps.audit('channel.draft_blocked', {
        actor: deps.actor,
        target: { type: 'draft', id: draftId },
        outcome: 'denied',
        metadata: { approvalId: approvalId ?? null, blockedDomains: error.domains.join(',') },
      });
    }
    throw error;
  }
  const metadata = {
    approvalId: approvalId ?? null,
    recipientDomain: domainOf(recipients.to[0] ?? ''),
    recipientCount: recipients.to.length + recipients.cc.length,
  };
  const target = { type: 'draft', id: draftId };
  await deps.audit(
    'channel.draft_sent',
    { actor: deps.actor, target, outcome: 'pending', metadata },
    { failClosed: true },
  );
  try {
    await mailer.sendDraft(draftId);
  } catch (error) {
    await deps.audit('channel.draft_sent', {
      actor: deps.actor,
      target,
      outcome: 'failure',
      metadata,
    });
    throw error;
  }
  await deps.audit('channel.draft_sent', { actor: deps.actor, target, metadata });
  return 'sent';
}
