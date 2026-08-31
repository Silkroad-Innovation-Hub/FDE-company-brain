const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const { createModels, createMethods, logger } = require('@librechat/data-schemas');
const {
  createGate,
  createBrainEmbed,
  createBrainRetriever,
  startBrainWorker,
  runBrainWorkerOnce,
  parseBudgetConfig,
  startBudgetMonitor,
  startBriefSchedule,
  startDailySchedule,
  runChase,
  createBrainChat,
  createCalendarClient,
  createGmailClient,
  createDraftPolicy,
  parseDraftDomains,
  createChannelAudit,
} = require('@librechat/api');
const connect = require('./connect');
const { startHeartbeat } = require('./heartbeat');

const vaultPath = process.env.BRAIN_VAULT_PATH || path.resolve(__dirname, '..', 'brain');
const approvalRequired = (process.env.BRAIN_WRITE_APPROVAL || 'on').toLowerCase() !== 'off';
const parseNumber = (value, fallback) =>
  value !== undefined && Number.isFinite(Number(value)) ? Number(value) : fallback;
const intervalMs = parseNumber(process.env.BRAIN_WORKER_INTERVAL_MS, 15_000);
const quietMs = parseNumber(process.env.BRAIN_QUIET_MS, 15_000);
const logDays = parseNumber(process.env.BRAIN_RETRIEVAL_LOG_DAYS, 90);
const maxVectors = parseNumber(process.env.BRAIN_RETRIEVAL_MAX_VECTORS, 20_000);
const dedupThreshold = parseNumber(process.env.BRAIN_DEDUP_THRESHOLD, 0.95);

const timeZone = process.env.SILKROAD_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone;
const briefHour = parseNumber(process.env.BRIEF_HOUR, 7);
const chaseHour = parseNumber(process.env.CHASE_HOUR, 8);
const chaseWeekday = parseNumber(process.env.CHASE_WEEKDAY, 1);

/** Gmail client + draft policy when the OAuth env is present; the chase drafts approvals without it. */
function gmailForChase(ownerEmail) {
  const policy = createDraftPolicy({
    ownerEmail,
    allowedDomains: parseDraftDomains(process.env.SILKROAD_DRAFT_DOMAINS),
  });
  const { GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN } = process.env;
  if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) {
    return { policy, api: undefined, calendar: undefined };
  }
  const credentials = {
    clientId: GMAIL_CLIENT_ID,
    clientSecret: GMAIL_CLIENT_SECRET,
    refreshToken: GMAIL_REFRESH_TOKEN,
  };
  return {
    policy,
    api: createGmailClient({ ...credentials, ownerEmail, policy }),
    calendar: createCalendarClient(credentials),
  };
}

/** Proactive work (roadmap A4): the morning brief every day, the invoice chase once a week. */
function startWorkflows({ methods, ownerId, ownerEmail, budget }) {
  const chat = createBrainChat({ apiKey: process.env.OPENAI_API_KEY, json: false });
  const jsonChat = createBrainChat({ apiKey: process.env.OPENAI_API_KEY });
  const { policy, api, calendar } = gmailForChase(ownerEmail);
  const audit = createChannelAudit(methods.recordAuditEntry, { user: ownerId });
  const brief = startBriefSchedule({
    methods,
    budget,
    timeZone,
    logger,
    chat,
    model: process.env.BRIEF_MODEL,
    calendar,
    user: ownerId,
    hour: briefHour,
  });
  const chase = startDailySchedule({
    hour: chaseHour,
    timeZone,
    logger,
    run: async () => {
      if (new Date().getDay() !== chaseWeekday) {
        return;
      }
      const result = await runChase(
        { vaultPath, methods, policy, audit, api, chat: jsonChat, logger },
        ownerId,
      );
      logger.info(
        `chase: drafted ${result.drafted.length}, sent ${result.sent.length}, blocked ${result.blocked.length}`,
      );
    },
  });
  logger.info(
    `workflows: brief daily at ${briefHour}:00 ${timeZone} (next ${brief.nextRunAt().toISOString()}), chase weekday ${chaseWeekday} at ${chaseHour}:00 (next check ${chase.nextRunAt().toISOString()}), gmail ${api ? 'on' : 'off'}`,
  );
}

(async () => {
  await connect();
  createModels(mongoose);
  const methods = createMethods(mongoose);
  startHeartbeat(methods, 'brain-worker', 'distiller + budget monitor', logger);
  const gate = createGate({
    apiKey: process.env.OPENAI_API_KEY,
    triageModel: process.env.BRAIN_TRIAGE_MODEL,
    distillModel: process.env.BRAIN_DISTILL_MODEL,
  });
  const ownerEmail = process.env.SILKROAD_USER_EMAIL;
  const owner = ownerEmail ? await methods.findUser({ email: ownerEmail }, '_id') : null;
  const ownerId = owner ? String(owner._id) : undefined;
  if (!ownerId) {
    logger.warn(
      'brain: SILKROAD_USER_EMAIL unset or unknown — retrieval index and kill switch disabled',
    );
  }
  const isPaused = ownerId ? () => methods.isChannelsPaused(ownerId) : undefined;
  const embed = createBrainEmbed({
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.BRAIN_EMBED_MODEL,
  });
  const retriever = ownerId
    ? createBrainRetriever({
        methods,
        embed,
        logger,
        options: { logDays, maxVectors, embedModel: process.env.BRAIN_EMBED_MODEL },
      })
    : undefined;
  if (retriever && ownerId) {
    const synced = await retriever.syncVault(ownerId, vaultPath);
    logger.info(
      `brain: vault index ready (${synced.indexed} chunks embedded, ${synced.unchanged} unchanged, ${synced.removed} removed)`,
    );
  }
  const deps = {
    methods,
    gate,
    vaultPath,
    approvalRequired,
    claim: { quietMs },
    logger,
    isPaused,
    retriever,
    owner: ownerId,
    dedupThreshold,
  };
  if (process.env.BRAIN_WORKER_ONCE === 'true') {
    let processed;
    do {
      processed = await runBrainWorkerOnce(deps);
    } while (processed > 0);
    logger.info('brain: one-shot distillation pass complete');
    process.exit(0);
  }
  startBrainWorker({ ...deps, intervalMs });
  if (ownerId) {
    const budget = parseBudgetConfig(process.env);
    startBudgetMonitor({
      methods,
      config: budget,
      user: ownerId,
      intervalMs: parseNumber(process.env.SILKROAD_BUDGET_CHECK_MS, 60 * 60_000),
      logger,
    });
    logger.info(
      `guardrails: budget monitor up (expected $${budget.expectedUsd}/month, alerts at ${budget.multiples.join('×, ')}×, hard pause ${budget.hardPause ? 'on' : 'off'})`,
    );
    startWorkflows({ methods, ownerId, ownerEmail, budget });
  }
  logger.info(
    `brain: distiller worker up (vault: ${vaultPath}, approval: ${approvalRequired ? 'on' : 'off'}, interval: ${intervalMs}ms, retrieval: ${retriever ? 'on' : 'off'})`,
  );
})();
