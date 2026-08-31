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
const CSV_MAX_ROWS = 5_000;
const CSV_BOM = '\ufeff';
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/** Quotes for CSV and neutralises spreadsheet formula prefixes (same rule as the admin export). */
function csvCell(value) {
  const text = value == null ? '' : String(value);
  if (text === '') {
    return '';
  }
  const guarded = FORMULA_PREFIX.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

const CSV_COLUMNS = [
  ['Time', (e) => e.timestamp],
  ['Action', (e) => e.action],
  ['Category', (e) => e.category],
  ['Outcome', (e) => e.outcome],
  ['Actor', (e) => e.actor?.name ?? ''],
  ['Target', (e) => [e.target?.type, e.target?.name ?? e.target?.id].filter(Boolean).join(':')],
  ['Details', (e) => (e.metadata ? JSON.stringify(e.metadata) : '')],
];

/** Walks the keyset-paginated audit log until the row cap, keeping only the owner's entries. */
async function collectOwnerEntries(req, max) {
  const rows = [];
  let cursor;
  for (let page = 0; page < Math.ceil(max / ACTIVITY_SCAN_LIMIT) * 4 && rows.length < max; page++) {
    const result = await listAuditLogPage(req.user.tenantId, {
      category: ACTIVITY_CATEGORIES,
      limit: ACTIVITY_SCAN_LIMIT,
      ...(cursor != null ? { cursor } : {}),
    });
    rows.push(...result.entries.filter(ownedBy(req.user.id)));
    if (result.nextCursor == null || result.entries.length === 0) {
      break;
    }
    cursor = result.nextCursor;
  }
  return rows.slice(0, max);
}

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

router.get('/activity.csv', async (req, res) => {
  try {
    const entries = await collectOwnerEntries(req, CSV_MAX_ROWS);
    const lines = [CSV_COLUMNS.map(([label]) => csvCell(label)).join(',')];
    for (const entry of entries) {
      lines.push(CSV_COLUMNS.map(([, value]) => csvCell(value(entry))).join(','));
    }
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="silkroad-activity-${stamp}.csv"`);
    res.status(200).send(CSV_BOM + lines.join('\r\n') + '\r\n');
  } catch (error) {
    logger.error('Error exporting guardrail activity:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
