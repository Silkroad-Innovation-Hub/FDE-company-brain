import type { ApprovalLean } from '@librechat/data-schemas';

/** The slice of the Gmail client the approval decision needs. */
export interface DraftMailer {
  sendDraft: (draftId: string) => Promise<void>;
  deleteDraft: (draftId: string) => Promise<void>;
}

export type DraftDecisionOutcome = 'sent' | 'deleted' | 'none';

/**
 * Executes the side effect of a decided email approval: an approved draft is
 * sent, a denied draft is deleted. Approvals without a draft are inert — the
 * decision itself is the whole action. This is the one place agent-drafted
 * mail can leave the account (brief §6: outbound = draft + approval).
 */
export async function applyDraftDecision(
  mailer: DraftMailer | null,
  approval: Pick<ApprovalLean, 'kind' | 'status' | 'payload'>,
): Promise<DraftDecisionOutcome> {
  const draftId = approval.payload?.draftId;
  if (approval.kind !== 'email' || !draftId) {
    return 'none';
  }
  if (!mailer) {
    throw new Error('Email approval has a draft but no Gmail credentials are configured');
  }
  if (approval.status === 'approved') {
    await mailer.sendDraft(draftId);
    return 'sent';
  }
  if (approval.status === 'denied') {
    await mailer.deleteDraft(draftId);
    return 'deleted';
  }
  return 'none';
}
