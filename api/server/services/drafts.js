const {
  ownerActor,
  domainOf,
  createGmailClient,
  createDraftPolicy,
  parseDraftDomains,
  parseContacts,
  applyDraftDecision,
  createChannelAudit,
} = require('@librechat/api');
const { getApprovals, decideApproval, reopenApproval, recordAuditEntry } = require('~/models');

/** Named contacts the owner refers to by first name (`SILKROAD_CONTACTS=Name=address,...`). */
function contactsFor() {
  return parseContacts(process.env.SILKROAD_CONTACTS);
}

/**
 * Draft-domain allowlist for the owner (brief §6); empty env = owner's own
 * address only. Named contacts are always allowed.
 */
function draftPolicyFor(ownerEmail) {
  return createDraftPolicy({
    ownerEmail: process.env.SILKROAD_USER_EMAIL || ownerEmail || '',
    allowedDomains: parseDraftDomains(process.env.SILKROAD_DRAFT_DOMAINS),
    allowedAddresses: contactsFor().map((contact) => contact.email),
  });
}

/** Gmail client for draft create/send/delete; null when the channel is not configured. */
function draftMailerFor(policy) {
  const { GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, SILKROAD_USER_EMAIL } =
    process.env;
  if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN || !SILKROAD_USER_EMAIL) {
    return null;
  }
  return createGmailClient({
    clientId: GMAIL_CLIENT_ID,
    clientSecret: GMAIL_CLIENT_SECRET,
    refreshToken: GMAIL_REFRESH_TOKEN,
    ownerEmail: SILKROAD_USER_EMAIL,
    policy,
  });
}

function auditFor(user) {
  return {
    audit: createChannelAudit(recordAuditEntry, { tenantId: user.tenantId, user: user.id }),
    actor: ownerActor(user.id, user.email || 'owner'),
  };
}

const hasDraft = (approval) =>
  approval.kind === 'email' && approval.status === 'pending' && Boolean(approval.payload?.draftId);

/**
 * Decides the owner's most recent pending email draft — the "send" / "scrap it"
 * text commands. Runs the same audited, policy-checked path as the approvals
 * route, and reopens the approval if the side effect fails.
 *
 * @param {{ id: string, email?: string, tenantId?: string }} user
 * @param {'approved' | 'denied'} status
 * @returns {Promise<{ outcome: 'sent' | 'deleted' | 'none', to?: string, subject?: string }>}
 */
async function decideLatestDraft(user, status) {
  const pending = (await getApprovals(user.id)).filter(hasDraft);
  if (pending.length === 0) {
    return { outcome: 'none' };
  }
  const latest = pending[0];
  const approval = await decideApproval(user.id, String(latest._id), status);
  if (!approval) {
    return { outcome: 'none' };
  }
  const { audit, actor } = auditFor(user);
  const target = { type: 'approval', id: String(approval._id) };
  const metadata = {
    kind: approval.kind,
    hasDraft: true,
    recipientDomain: approval.payload?.to ? domainOf(approval.payload.to) : null,
    via: 'channel',
  };
  await audit(status === 'approved' ? 'approval.approved' : 'approval.denied', {
    actor,
    target,
    outcome: status === 'approved' ? 'success' : 'denied',
    metadata,
  });
  const policy = draftPolicyFor(user.email);
  try {
    const outcome = await applyDraftDecision(
      { mailer: draftMailerFor(policy), policy, audit, actor },
      approval,
    );
    return { outcome, to: approval.payload?.to, subject: approval.payload?.subject };
  } catch (error) {
    await reopenApproval(user.id, String(approval._id));
    await audit('approval.reopened', { actor, target, outcome: 'failure', metadata });
    throw error;
  }
}

module.exports = { contactsFor, draftPolicyFor, draftMailerFor, auditFor, decideLatestDraft };
