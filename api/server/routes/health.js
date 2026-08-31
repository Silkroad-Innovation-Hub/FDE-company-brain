const express = require('express');
const { logger } = require('@librechat/data-schemas');
const { listHeartbeats } = require('~/models');

const router = express.Router();

const ALIVE_WITHIN_MS = 90_000;

/**
 * Liveness of the Silkroad processes for supervisors and the dashboard.
 * Unauthenticated by design, so it exposes names and ages only — never
 * hostnames or pids.
 */
router.get('/silkroad', async (req, res) => {
  try {
    const now = Date.now();
    const processes = (await listHeartbeats()).map((beat) => {
      const staleSeconds = Math.round((now - new Date(beat.lastSeenAt).getTime()) / 1000);
      return {
        name: beat.name,
        lastSeenAt: beat.lastSeenAt,
        staleSeconds,
        alive: staleSeconds * 1000 <= ALIVE_WITHIN_MS,
      };
    });
    res.status(200).json({ ok: true, processes });
  } catch (error) {
    logger.error('[health] silkroad heartbeat read failed', error);
    res.status(500).json({ ok: false, processes: [] });
  }
});

module.exports = router;
