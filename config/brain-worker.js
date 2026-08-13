const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const { createModels, createMethods, logger } = require('@librechat/data-schemas');
const { createGate, startBrainWorker, runBrainWorkerOnce } = require('@librechat/api');
const connect = require('./connect');

const vaultPath = process.env.BRAIN_VAULT_PATH || path.resolve(__dirname, '..', 'brain');
const approvalRequired = (process.env.BRAIN_WRITE_APPROVAL || 'on').toLowerCase() !== 'off';
const parseMs = (value, fallback) =>
  Number.isFinite(Number(value)) && value !== undefined ? Number(value) : fallback;
const intervalMs = parseMs(process.env.BRAIN_WORKER_INTERVAL_MS, 15_000);
const quietMs = parseMs(process.env.BRAIN_QUIET_MS, 15_000);

(async () => {
  await connect();
  createModels(mongoose);
  const methods = createMethods(mongoose);
  const gate = createGate({
    apiKey: process.env.OPENAI_API_KEY,
    triageModel: process.env.BRAIN_TRIAGE_MODEL,
    distillModel: process.env.BRAIN_DISTILL_MODEL,
  });
  const deps = { methods, gate, vaultPath, approvalRequired, claim: { quietMs }, logger };
  if (process.env.BRAIN_WORKER_ONCE === 'true') {
    let processed;
    do {
      processed = await runBrainWorkerOnce(deps);
    } while (processed > 0);
    logger.info('brain: one-shot distillation pass complete');
    process.exit(0);
  }
  startBrainWorker({ ...deps, intervalMs });
  logger.info(
    `brain: distiller worker up (vault: ${vaultPath}, approval: ${approvalRequired ? 'on' : 'off'}, interval: ${intervalMs}ms)`,
  );
})();
