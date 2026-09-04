const os = require('os');
const express = require('express');
const { logger } = require('@librechat/data-schemas');
const { createChannelAudit, ownerActor } = require('@librechat/api');
const {
  listWorkflowPolicies,
  setWorkflowPolicy,
  listHeartbeats,
  recordAuditEntry,
} = require('~/models');
const { requireJwtAuth } = require('~/server/middleware');

const router = express.Router();

router.use(requireJwtAuth);

/** The two workflows the trust ramp governs; `brief` never sends, so it has no auto-send. */
const WORKFLOWS = [
  { workflow: 'brief', canAutoSend: false },
  { workflow: 'chase', canAutoSend: true },
];
const WORKFLOW_NAMES = new Set(WORKFLOWS.map((w) => w.workflow));

/** Processes the dashboard expects; heartbeat names are matched loosely so runners can name themselves. */
const EXPECTED_PROCESSES = [
  { key: 'worker', match: /worker/i },
  { key: 'imessage', match: /imessage/i },
  { key: 'photon', match: /photon/i },
  { key: 'gmail', match: /gmail|email/i },
];
const ALIVE_WITHIN_MS = 90_000;

function withDefaults(rows) {
  const byName = new Map(rows.map((row) => [row.workflow, row]));
  return WORKFLOWS.map(({ workflow, canAutoSend }) => {
    const row = byName.get(workflow);
    return {
      workflow,
      canAutoSend,
      enabled: row?.enabled ?? true,
      autoSend: canAutoSend ? (row?.autoSend ?? false) : false,
      graduatedAt: row?.graduatedAt ?? null,
      lastRunAt: row?.lastRunAt ?? null,
      lastRunSummary: row?.lastRunSummary ?? null,
    };
  });
}

function auditContext(req) {
  return {
    audit: createChannelAudit(recordAuditEntry, { tenantId: req.user.tenantId, user: req.user.id }),
    actor: ownerActor(req.user.id, req.user.email || 'owner'),
  };
}

router.get('/policies', async (req, res) => {
  try {
    const rows = await listWorkflowPolicies(req.user.id);
    res.status(200).json(withDefaults(rows));
  } catch (error) {
    logger.error('Error listing workflow policies:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/policies/:workflow', async (req, res) => {
  const { workflow } = req.params;
  const { enabled, autoSend } = req.body ?? {};
  if (!WORKFLOW_NAMES.has(workflow)) {
    return res.status(404).json({ error: 'Unknown workflow' });
  }
  if (
    (enabled !== undefined && typeof enabled !== 'boolean') ||
    (autoSend !== undefined && typeof autoSend !== 'boolean')
  ) {
    return res.status(400).json({ error: 'enabled and autoSend must be booleans' });
  }
  const definition = WORKFLOWS.find((w) => w.workflow === workflow);
  if (autoSend === true && !definition.canAutoSend) {
    return res.status(400).json({ error: 'This workflow has nothing to send' });
  }
  try {
    const update = {};
    if (enabled !== undefined) {
      update.enabled = enabled;
    }
    if (autoSend !== undefined) {
      update.autoSend = autoSend;
    }
    const policy = await setWorkflowPolicy(req.user.id, workflow, update);
    const { audit, actor } = auditContext(req);
    const target = { type: 'workflow', id: workflow, name: `workflow:${workflow}` };
    const metadata = { user: req.user.id, workflow };
    if (enabled !== undefined) {
      await audit(enabled ? 'channel.resumed' : 'channel.paused', {
        actor,
        target,
        metadata: { ...metadata, via: 'dashboard' },
      });
    }
    if (autoSend !== undefined) {
      await audit(autoSend ? 'approval.approved' : 'approval.reopened', {
        actor,
        target,
        severity: autoSend ? 'warning' : 'info',
        metadata: { ...metadata, autoSend },
      });
    }
    res.status(200).json(withDefaults([policy]).find((row) => row.workflow === workflow));
  } catch (error) {
    logger.error('Error updating workflow policy:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/health', async (req, res) => {
  try {
    const beats = await listHeartbeats();
    const now = Date.now();
    const health = EXPECTED_PROCESSES.map(({ key, match }) => {
      const beat = beats.find((row) => match.test(row.name));
      const lastSeenAt = beat?.lastSeenAt ?? null;
      return {
        name: key,
        process: beat?.name ?? null,
        host: beat?.host ?? null,
        lastSeenAt,
        alive: lastSeenAt != null && now - new Date(lastSeenAt).getTime() < ALIVE_WITHIN_MS,
      };
    });
    res.status(200).json({ host: os.hostname(), processes: health });
  } catch (error) {
    logger.error('Error reading process health:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
