/**
 * Gmail → second-brain connector (context/channels.md).
 * Polls the owner's mailbox, appends every message to the `brainlogs` raw log
 * (the distiller worker does triage / to-dos / notes) and answers questions the
 * owner emails to themselves. Never replies to third parties.
 *
 * One-time setup: `npm run gmail:auth` to obtain GMAIL_REFRESH_TOKEN.
 * State: data/gmail-ingest-state.json ({ historyId }).
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const { createModels, createMethods, logger } = require('@librechat/data-schemas');
const {
  createBrainChat,
  createGatewayClient,
  createGmailClient,
  startGmailPoller,
} = require('@librechat/api');
const connect = require('./connect');
const { startHeartbeat } = require('./heartbeat');

const STATE_FILE = path.resolve(__dirname, '..', 'data', 'gmail-ingest-state.json');
const vaultPath = process.env.BRAIN_VAULT_PATH || path.resolve(__dirname, '..', 'brain');
const intervalMs = Number(process.env.GMAIL_POLL_MS) || 60_000;
const backfill = Number(process.env.INGEST_BACKFILL) || 0;
const once = process.env.INGEST_ONCE === 'true';
const model = process.env.BRAIN_ANSWER_MODEL || 'gpt-5.5';

/** Answers go through the API gateway (the web-chat agent) when a service token is configured. */
function gatewayClient() {
  const token = process.env.SILKROAD_SERVICE_TOKEN;
  if (!token) {
    logger.warn('[gmail] SILKROAD_SERVICE_TOKEN unset — answering with the local chat fallback');
    return undefined;
  }
  return createGatewayClient({
    url: process.env.SILKROAD_API_URL || 'http://127.0.0.1:3080',
    token,
    timeoutMs: Number(process.env.SILKROAD_CHANNEL_TIMEOUT_MS) + 10_000 || undefined,
  });
}

const store = {
  load() {
    try {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    } catch {
      return null;
    }
  },
  save(state) {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
  },
};

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required (see context/channels.md, npm run gmail:auth)`);
  }
  return value;
}

(async () => {
  const email = requireEnv('SILKROAD_USER_EMAIL');
  const clientId = requireEnv('GMAIL_CLIENT_ID');
  const clientSecret = requireEnv('GMAIL_CLIENT_SECRET');
  const refreshToken = requireEnv('GMAIL_REFRESH_TOKEN');
  await connect();
  createModels(mongoose);
  const methods = createMethods(mongoose);
  startHeartbeat(methods, 'channel-gmail', 'Gmail connector', logger);
  const owner = await methods.findUser({ email }, '_id');
  if (!owner) {
    throw new Error(`Owner user ${email} not found`);
  }
  const api = createGmailClient({ clientId, clientSecret, refreshToken, ownerEmail: email });
  const chat = createBrainChat({ apiKey: process.env.OPENAI_API_KEY, json: false });
  const handle = await startGmailPoller({
    gateway: gatewayClient(),
    api,
    methods,
    chat,
    model,
    vaultPath,
    owner: { user: String(owner._id), email },
    logger,
    store,
    backfill,
    intervalMs,
    once,
  });
  if (once) {
    handle.stop();
    logger.info('gmail: single pass complete');
    await mongoose.disconnect();
    process.exit(0);
  }
  logger.info(`gmail: connector up for ${email} (every ${intervalMs}ms, vault: ${vaultPath})`);
})().catch((error) => {
  logger.error('gmail: connector failed to start', error);
  process.exit(1);
});
