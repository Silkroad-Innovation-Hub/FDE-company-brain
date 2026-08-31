const express = require('express');
const { logger } = require('@librechat/data-schemas');
const { parseBudgetConfig, getBudgetStatus } = require('@librechat/api');
const {
  sumTransactionValueSince,
  getGuardrailState,
  isChannelsPaused,
  listAuditLogPage,
} = require('~/models');
const { requireJwtAuth } = require('~/server/middleware');

const router = express.Router();

router.use(requireJwtAuth);

const ACTIVITY_CATEGORIES = ['channel', 'approval', 'guardrail', 'brain'];
const ACTIVITY_SCAN_LIMIT = 500;
const ACTIVITY_DEFAULT_LIMIT = 50;

/** Entries belong to the owner when they acted, or when a system/agent entry names them in metadata. */
function ownedBy(userId) {
  return (entry) => entry.actor?.id === userId || entry.metadata?.user === userId;
}

router.get('/status', async (req, res) => {
  try {
    const status = await getBudgetStatus(
      {
        methods: { sumTransactionValueSince, getGuardrailState, isChannelsPaused },
        config: parseBudgetConfig(process.env),
      },
      req.user.id,
    );
    res.status(200).json(status);
  } catch (error) {
    logger.error('Error reading guardrail status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/activity', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || ACTIVITY_DEFAULT_LIMIT, ACTIVITY_SCAN_LIMIT);
    const page = await listAuditLogPage(req.user.tenantId, {
      category: ACTIVITY_CATEGORIES,
      limit: ACTIVITY_SCAN_LIMIT,
    });
    const entries = page.entries.filter(ownedBy(req.user.id)).slice(0, limit);
    res.status(200).json({ entries, total: entries.length, nextCursor: null });
  } catch (error) {
    logger.error('Error reading guardrail activity:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
