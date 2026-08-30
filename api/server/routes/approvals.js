const express = require('express');
const { logger } = require('@librechat/data-schemas');
const { applyDraftDecision, createGmailClient } = require('@librechat/api');
const { getApprovals, createApproval, decideApproval, reopenApproval } = require('~/models');
const { requireJwtAuth } = require('~/server/middleware');

const router = express.Router();

router.use(requireJwtAuth);

const kinds = new Set(['email', 'message', 'document']);
const decisions = new Set(['approved', 'denied']);

/** Gmail client for draft send/delete; null when the channel is not configured. */
function draftMailer() {
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
  });
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
    const { kind, title, description } = req.body;
    if (!kinds.has(kind) || typeof title !== 'string' || typeof description !== 'string') {
      return res.status(400).json({ error: 'kind, title, and description are required' });
    }
    const approval = await createApproval(req.user.id, req.body);
    res.status(201).json(approval);
  } catch (error) {
    logger.error('Error creating approval:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:approvalId', async (req, res) => {
  try {
    if (!decisions.has(req.body.status)) {
      return res.status(400).json({ error: 'status must be approved or denied' });
    }
    const approval = await decideApproval(req.user.id, req.params.approvalId, req.body.status);
    if (!approval) {
      return res.status(404).json({ error: 'Pending approval not found' });
    }
    try {
      await applyDraftDecision(draftMailer(), approval);
    } catch (error) {
      logger.error('Error executing approval decision, reopening:', error);
      const reopened = await reopenApproval(req.user.id, req.params.approvalId);
      return res.status(502).json({ error: 'Decision could not be executed', approval: reopened });
    }
    res.status(200).json(approval);
  } catch (error) {
    logger.error('Error deciding approval:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
