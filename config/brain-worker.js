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
} = require('@librechat/api');
const connect = require('./connect');

const vaultPath = process.env.BRAIN_VAULT_PATH || path.resolve(__dirname, '..', 'brain');
const approvalRequired = (process.env.BRAIN_WRITE_APPROVAL || 'on').toLowerCase() !== 'off';
const parseNumber = (value, fallback) =>
  value !== undefined && Number.isFinite(Number(value)) ? Number(value) : fallback;
const intervalMs = parseNumber(process.env.BRAIN_WORKER_INTERVAL_MS, 15_000);
const quietMs = parseNumber(process.env.BRAIN_QUIET_MS, 15_000);
const logDays = parseNumber(process.env.BRAIN_RETRIEVAL_LOG_DAYS, 90);
const maxVectors = parseNumber(process.env.BRAIN_RETRIEVAL_MAX_VECTORS, 20_000);
const dedupThreshold = parseNumber(process.env.BRAIN_DEDUP_THRESHOLD, 0.95);

(async () => {
  await connect();
  createModels(mongoose);
  const methods = createMethods(mongoose);
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
  }
  logger.info(
    `brain: distiller worker up (vault: ${vaultPath}, approval: ${approvalRequired ? 'on' : 'off'}, interval: ${intervalMs}ms, retrieval: ${retriever ? 'on' : 'off'})`,
  );
})();
