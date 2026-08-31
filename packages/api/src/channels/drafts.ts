import type { ApprovalLean, ApprovalCreateData } from '@librechat/data-schemas';
import type { DraftPolicy } from './policy';
import type { GmailApi } from './gmail/client';
import type { ChannelAudit } from './audit';
import { RecipientNotAllowedError, domainOf } from './policy';
import { AGENT_ACTOR } from './audit';

export interface DraftRequest {
  to: string;
  cc?: string;
  subject: string;
  body: string;
  threadId?: string;
  title: string;
  description: string;
}

export interface DraftDeps {
  api: Pick<GmailApi, 'createDraft'>;
  policy: DraftPolicy;
  methods: {
    createApproval: (user: string, data: ApprovalCreateData) => Promise<ApprovalLean>;
    decideApproval: (
      user: string,
      approvalId: string,
      status: 'approved' | 'denied',
    ) => Promise<ApprovalLean | null>;
  };
  audit: ChannelAudit;
}

export type DraftResult =
  | { blocked: false; draftId: string; approval: ApprovalLean }
  | { blocked: true; domains: string[]; approval: ApprovalLean };

/**
 * The only sanctioned way to create an email approval that carries a Gmail
 * draft: the recipient policy runs first, the draft is created, then the
 * approval that references it. A blocked request creates no draft — only a
 * denied approval so the owner can see what the agent tried to do.
 */
export async function draftEmailForApproval(
  deps: DraftDeps,
  user: string,
  request: DraftRequest,
): Promise<DraftResult> {
  try {
    deps.policy.assertRecipientsAllowed({ to: request.to, cc: request.cc });
  } catch (error) {
    if (!(error instanceof RecipientNotAllowedError)) {
      throw error;
    }
    return blockDraft(deps, user, request, error.domains);
  }

  const draftId = await deps.api.createDraft({
    to: request.to,
    cc: request.cc,
    subject: request.subject,
    text: request.body,
    threadId: request.threadId,
  });
  const approval = await deps.methods.createApproval(user, {
    kind: 'email',
    title: request.title,
    description: request.description,
    payload: {
      to: request.to,
      cc: request.cc,
      subject: request.subject,
      body: request.body,
      draftId,
    },
  });
  await deps.audit('channel.draft_created', {
    actor: AGENT_ACTOR,
    target: { type: 'draft', id: draftId },
    metadata: {
      approvalId: String(approval._id),
      recipientDomain: domainOf(request.to),
      hasCc: Boolean(request.cc),
    },
  });
  return { blocked: false, draftId, approval };
}

async function blockDraft(
  deps: DraftDeps,
  user: string,
  request: DraftRequest,
  domains: string[],
): Promise<DraftResult> {
  const created = await deps.methods.createApproval(user, {
    kind: 'email',
    title: request.title,
    description: `Blocked: ${domains.join(', ')} is not on the draft allowlist. No draft was created.`,
    payload: { to: request.to, cc: request.cc, subject: request.subject, body: request.body },
  });
  const denied = await deps.methods.decideApproval(user, String(created._id), 'denied');
  await deps.audit('channel.draft_blocked', {
    actor: AGENT_ACTOR,
    target: { type: 'approval', id: String(created._id) },
    outcome: 'denied',
    metadata: { blockedDomains: domains.join(','), recipientDomain: domainOf(request.to) },
  });
  return { blocked: true, domains, approval: denied ?? created };
}
