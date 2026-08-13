const path = require('path');
const express = require('express');
const { logger } = require('@librechat/data-schemas');
const { loadVault, buildBrainGraph, readBrainNote } = require('@librechat/api');
const { requireJwtAuth } = require('~/server/middleware');

const router = express.Router();

const vaultPath =
  process.env.BRAIN_VAULT_PATH || path.resolve(__dirname, '..', '..', '..', 'brain');

const CACHE_TTL_MS = 30_000;
let graphCache = null;
let graphCacheAt = 0;

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

module.exports = router;
