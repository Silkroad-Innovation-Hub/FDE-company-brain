const express = require('express');
const { logger } = require('@librechat/data-schemas');
const {
  runBrief,
  createBrainChat,
  parseBudgetConfig,
  createCalendarClient,
  BRIEF_WORKFLOW,
} = require('@librechat/api');
const {
  getTodos,
  getApprovals,
  listBrainLogs,
  getWorkflowPolicy,
  setWorkflowPolicy,
  createChannelNotice,
  sumTransactionValueSince,
  getGuardrailState,
  isChannelsPaused,
} = require('~/models');
const { requireJwtAuth } = require('~/server/middleware');

const router = express.Router();

router.use(requireJwtAuth);

const BRIEF_CHAT_TIMEOUT_MS = 45_000;

function calendarClient() {
  const { GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN } = process.env;
  if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) {
    return undefined;
  }
  return createCalendarClient({
    clientId: GMAIL_CLIENT_ID,
    clientSecret: GMAIL_CLIENT_SECRET,
    refreshToken: GMAIL_REFRESH_TOKEN,
  });
}

function briefDeps() {
  return {
    methods: {
      getTodos,
      getApprovals,
      listBrainLogs,
      getWorkflowPolicy,
      setWorkflowPolicy,
      createChannelNotice,
      sumTransactionValueSince,
      getGuardrailState,
      isChannelsPaused,
    },
    budget: parseBudgetConfig(process.env),
    timeZone: process.env.SILKROAD_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone,
    logger,
    chat: process.env.OPENAI_API_KEY
      ? createBrainChat({
          apiKey: process.env.OPENAI_API_KEY,
          json: false,
          timeoutMs: BRIEF_CHAT_TIMEOUT_MS,
        })
      : undefined,
    model: process.env.BRIEF_MODEL,
    calendar: calendarClient(),
  };
}

/** "Send me the brief now": composes it and queues it for the owner's phone too. */
router.post('/run', async (req, res) => {
  try {
    const result = await runBrief(briefDeps(), req.user.id);
    if (result.skipped) {
      return res.status(409).json({ error: 'Brief is disabled for this user' });
    }
    res.status(200).json({ text: result.text });
  } catch (error) {
    logger.error('[brief] run failed:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/latest', async (req, res) => {
  try {
    const policy = await getWorkflowPolicy(req.user.id, BRIEF_WORKFLOW);
    res.status(200).json({
      enabled: policy?.enabled !== false,
      lastRunAt: policy?.lastRunAt ?? null,
      text: policy?.lastRunSummary ?? null,
    });
  } catch (error) {
    logger.error('[brief] latest failed:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
