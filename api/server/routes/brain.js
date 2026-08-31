const path = require('path');
const express = require('express');
const { logger } = require('@librechat/data-schemas');
const {
  loadVault,
  ownerActor,
  buildBrainGraph,
  readBrainNote,
  applyBrainApproval,
  createChannelAudit,
} = require('@librechat/api');
const {
  listBrainLogs,
  getBrainLog,
  resolveBrainLog,
  countBrainLogsByStatus,
  getTodos,
  createTodo,
  recordAuditEntry,
} = require('~/models');
const { requireJwtAuth } = require('~/server/middleware');

const router = express.Router();

const vaultPath =
  process.env.BRAIN_VAULT_PATH || path.resolve(__dirname, '..', '..', '..', 'brain');

const CACHE_TTL_MS = 30_000;
let graphCache = null;
let graphCacheAt = 0;

const brainLogMethods = { getBrainLog, resolveBrainLog, getTodos, createTodo };

function auditWrite(req, action, entry, outcome) {
  const audit = createChannelAudit(recordAuditEntry, { tenantId: req.user.tenantId });
  return audit(action, {
    actor: ownerActor(req.user.id, req.user.email || 'owner'),
    target: { type: 'note', id: entry.noteId || undefined, name: entry.noteId || undefined },
    outcome,
    metadata: {
      brainLogId: String(entry._id),
      outcome: entry.outcome ?? null,
      hasTodos: Array.isArray(entry.todoItems) && entry.todoItems.length > 0,
    },
  });
}

router.use(requireJwtAuth);

router.get('/graph', async (req, res) => {
  try {
    if (!graphCache || Date.now() - graphCacheAt > CACHE_TTL_MS) {
      const notes = await loadVault(vaultPath);
      graphCache = buildBrainGraph(notes);
      graphCacheAt = Date.now();
    }
    res.status(200).json(graphCache);
  } catch (error) {
    logger.error('Error building brain graph:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/note/:noteId', async (req, res) => {
  try {
    const note = await readBrainNote(vaultPath, req.params.noteId);
    if (!note) {
      return res.status(404).json({ error: 'Note not found' });
    }
    res.status(200).json(note);
  } catch (error) {
    logger.error('Error reading brain note:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/approvals', async (req, res) => {
  try {
    const approvals = await listBrainLogs({ user: req.user.id, status: 'awaiting_approval' });
    res.status(200).json(approvals);
  } catch (error) {
    logger.error('Error listing brain approvals:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/approvals/:brainLogId/approve', async (req, res) => {
  try {
    const entry = await getBrainLog(req.params.brainLogId);
    if (!entry || entry.user !== req.user.id) {
      return res.status(404).json({ error: 'Approval not found' });
    }
    const applied = await applyBrainApproval(
      { methods: brainLogMethods, vaultPath, retriever: req.app.locals.brainRetriever, logger },
      req.params.brainLogId,
    );
    if (!applied) {
      return res.status(409).json({ error: 'Entry is not awaiting approval' });
    }
    graphCacheAt = 0;
    await auditWrite(req, 'brain.write_applied', applied, 'success');
    res.status(200).json(applied);
  } catch (error) {
    logger.error('Error approving brain write:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/approvals/:brainLogId/reject', async (req, res) => {
  try {
    const entry = await getBrainLog(req.params.brainLogId);
    if (!entry || entry.user !== req.user.id || entry.status !== 'awaiting_approval') {
      return res.status(404).json({ error: 'Approval not found' });
    }
    const rejected = await resolveBrainLog(req.params.brainLogId, { status: 'rejected' });
    await auditWrite(req, 'brain.write_rejected', rejected ?? entry, 'denied');
    res.status(200).json(rejected);
  } catch (error) {
    logger.error('Error rejecting brain write:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/ingest/stats', async (req, res) => {
  try {
    const counts = await countBrainLogsByStatus();
    res.status(200).json(counts);
  } catch (error) {
    logger.error('Error reading brain ingest stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
