const express = require('express');
const { logger } = require('@librechat/data-schemas');
const {
  ownerActor,
  domainOf,
  applyDraftDecision,
  createChannelAudit,
  RecipientNotAllowedError,
} = require('@librechat/api');
const { draftPolicyFor, draftMailerFor } = require('~/server/services/drafts');
const {
  getApprovals,
  createApproval,
  decideApproval,
  reopenApproval,
  recordAuditEntry,
} = require('~/models');
const { requireJwtAuth } = require('~/server/middleware');

const router = express.Router();

router.use(requireJwtAuth);

const kinds = new Set(['email', 'message', 'document']);
const decisions = new Set(['approved', 'denied']);
const stringFields = [
  'to',
  'cc',
  'subject',
  'body',
  'channel',
  'recipient',
  'text',
  'document',
  'summary',
];

function isChange(change) {
  return (
    change != null &&
    typeof change.field === 'string' &&
    (change.before == null || typeof change.before === 'string') &&
    (change.after == null || typeof change.after === 'string')
  );
}

/** Whitelists payload fields; `draftId` is never client-supplied (drafts come from draftEmailForApproval). */
function parsePayload(raw) {
  if (raw == null) {
    return { payload: {} };
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'payload must be an object' };
  }
  if (raw.draftId != null) {
    return { error: 'payload.draftId cannot be set by clients' };
  }
  const payload = {};
  for (const field of stringFields) {
    if (raw[field] == null) {
      continue;
    }
    if (typeof raw[field] !== 'string') {
      return { error: `payload.${field} must be a string` };
    }
    payload[field] = raw[field];
  }
  if (raw.changes != null) {
    if (!Array.isArray(raw.changes) || !raw.changes.every(isChange)) {
      return { error: 'payload.changes must be a list of { field, before, after }' };
    }
    payload.changes = raw.changes;
  }
  return { payload };
}

function draftPolicy(req) {
  return draftPolicyFor(req.user.email);
}

/** Gmail client for draft send/delete; null when the channel is not configured. */
function draftMailer(policy) {
  return draftMailerFor(policy);
}

function auditContext(req) {
  return {
    audit: createChannelAudit(recordAuditEntry, { tenantId: req.user.tenantId, user: req.user.id }),
    actor: ownerActor(req.user.id, req.user.email || 'owner'),
  };
}

function approvalMetadata(approval) {
  return {
    kind: approval.kind,
    hasDraft: Boolean(approval.payload?.draftId),
    recipientDomain: approval.payload?.to ? domainOf(approval.payload.to) : null,
  };
}

router.get('/', async (req, res) => {
  try {
    const approvals = await getApprovals(req.user.id);
    res.status(200).json(approvals);
  } catch (error) {
    logger.error('Error getting approvals:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { kind, title, description } = req.body ?? {};
    if (!kinds.has(kind) || typeof title !== 'string' || typeof description !== 'string') {
      return res.status(400).json({ error: 'kind, title, and description are required' });
    }
    const parsed = parsePayload(req.body.payload);
    if (parsed.error) {
      return res.status(400).json({ error: parsed.error });
    }
    if (kind === 'email' && parsed.payload.to) {
      try {
        draftPolicy(req).assertRecipientsAllowed({ to: parsed.payload.to, cc: parsed.payload.cc });
      } catch (error) {
        if (error instanceof RecipientNotAllowedError) {
          return res.status(403).json({ error: error.message, domains: error.domains });
        }
        throw error;
      }
    }
    const approval = await createApproval(req.user.id, {
      kind,
      title,
      description,
      payload: parsed.payload,
    });
    const { audit, actor } = auditContext(req);
    await audit('approval.created', {
      actor,
      target: { type: 'approval', id: String(approval._id) },
      metadata: approvalMetadata(approval),
    });
    res.status(201).json(approval);
  } catch (error) {
    logger.error('Error creating approval:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:approvalId', async (req, res) => {
  try {
    const status = req.body?.status;
    if (!decisions.has(status)) {
      return res.status(400).json({ error: 'status must be approved or denied' });
    }
    const approval = await decideApproval(req.user.id, req.params.approvalId, status);
    if (!approval) {
      return res.status(404).json({ error: 'Pending approval not found' });
    }
    const { audit, actor } = auditContext(req);
    const target = { type: 'approval', id: String(approval._id) };
    const metadata = approvalMetadata(approval);
    await audit(status === 'approved' ? 'approval.approved' : 'approval.denied', {
      actor,
      target,
      outcome: status === 'approved' ? 'success' : 'denied',
      metadata,
    });
    const policy = draftPolicy(req);
    try {
      await applyDraftDecision({ mailer: draftMailer(policy), policy, audit, actor }, approval);
    } catch (error) {
      logger.error('Error executing approval decision, reopening:', error);
      const reopened = await reopenApproval(req.user.id, req.params.approvalId);
      await audit('approval.reopened', {
        actor,
        target,
        outcome: 'failure',
        metadata: { ...metadata, blocked: error instanceof RecipientNotAllowedError },
      });
      if (error instanceof RecipientNotAllowedError) {
        return res
          .status(403)
          .json({ error: error.message, domains: error.domains, approval: reopened });
      }
      return res.status(502).json({ error: 'Decision could not be executed', approval: reopened });
    }
    res.status(200).json(approval);
  } catch (error) {
    logger.error('Error deciding approval:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
