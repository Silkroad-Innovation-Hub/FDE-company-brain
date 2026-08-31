const path = require('path');
const express = require('express');
const { logger } = require('@librechat/data-schemas');
const {
  runChase,
  createBrainChat,
  createGmailClient,
  createDraftPolicy,
  parseDraftDomains,
  createChannelAudit,
  findOverdueInvoices,
} = require('@librechat/api');
const {
  getWorkflowPolicy,
  setWorkflowPolicy,
  createApproval,
  decideApproval,
  reopenApproval,
  createChannelNotice,
  recordAuditEntry,
} = require('~/models');
const { requireJwtAuth } = require('~/server/middleware');

const router = express.Router();

router.use(requireJwtAuth);

const vaultPath =
  process.env.BRAIN_VAULT_PATH || path.resolve(__dirname, '..', '..', '..', 'brain');

function draftPolicy(req) {
  return createDraftPolicy({
    ownerEmail: process.env.SILKROAD_USER_EMAIL || req.user.email,
    allowedDomains: parseDraftDomains(process.env.SILKROAD_DRAFT_DOMAINS),
  });
}

function gmailApi(policy, ownerEmail) {
  const { GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN } = process.env;
  if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) {
    return undefined;
  }
  return createGmailClient({
    clientId: GMAIL_CLIENT_ID,
    clientSecret: GMAIL_CLIENT_SECRET,
    refreshToken: GMAIL_REFRESH_TOKEN,
    ownerEmail,
    policy,
  });
}

router.get('/overdue', async (req, res) => {
  try {
    res.status(200).json(await findOverdueInvoices(vaultPath));
  } catch (error) {
    logger.error('Error listing overdue invoices:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/run', async (req, res) => {
  try {
    const policy = draftPolicy(req);
    const result = await runChase(
      {
        vaultPath,
        methods: {
          getWorkflowPolicy,
          setWorkflowPolicy,
          createApproval,
          decideApproval,
          reopenApproval,
          createChannelNotice,
        },
        policy,
        audit: createChannelAudit(recordAuditEntry, {
          tenantId: req.user.tenantId ?? undefined,
          user: req.user.id,
        }),
        api: gmailApi(policy, policy.ownerEmail),
        chat: process.env.OPENAI_API_KEY
          ? createBrainChat({ apiKey: process.env.OPENAI_API_KEY })
          : undefined,
        model: process.env.BRAIN_ANSWER_MODEL || 'gpt-5.5',
        ownerName: req.user.name || req.user.username || 'the team',
        logger,
      },
      req.user.id,
    );
    res.status(200).json(result);
  } catch (error) {
    logger.error('Error running chase workflow:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
