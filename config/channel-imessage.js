/**
 * iMessage connector: polls ~/Library/Messages/chat.db, appends every message
 * to the brain raw log (the distiller worker does the model work), and answers
 * the owner's questions in their self-chat. See context/channels.md.
 *
 * Requires Full Disk Access for the invoking terminal (to read chat.db).
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const { createModels, createMethods, logger } = require('@librechat/data-schemas');
const {
  createBrainChat,
  createEchoGuard,
  createGatewayClient,
  createSqlRunner,
  resolveOwnHandles,
  guardedSender,
  maxRowId,
  pollOnce,
} = require('@librechat/api');
const connect = require('./connect');
const { startHeartbeat } = require('./heartbeat');

const STATE_FILE = path.resolve(__dirname, '..', 'data', 'imessage-ingest-state.json');
const vaultPath = process.env.BRAIN_VAULT_PATH || path.resolve(__dirname, '..', 'brain');
const model = process.env.BRAIN_ANSWER_MODEL || 'gpt-5.5';

/** Answers go through the API gateway (the web-chat agent) when a service token is configured. */
function gatewayClient() {
  const token = process.env.SILKROAD_SERVICE_TOKEN;
  if (!token) {
    logger.warn('[imessage] SILKROAD_SERVICE_TOKEN unset — answering with the local chat fallback');
    return undefined;
  }
  return createGatewayClient({
    url: process.env.SILKROAD_API_URL || 'http://127.0.0.1:3080',
    token,
    timeoutMs: Number(process.env.SILKROAD_CHANNEL_TIMEOUT_MS) + 10_000 || undefined,
  });
}
const intervalMs = Number(process.env.IMESSAGE_POLL_MS) || 15_000;
const backfill = Number(process.env.INGEST_BACKFILL) || 0;

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state));
}

function sendViaMessages(handle, text) {
  execFileSync('/usr/bin/osascript', [
    '-e',
    'on run {h, m}',
    '-e',
    'tell application "Messages"',
    '-e',
    'set svc to 1st account whose service type = iMessage',
    '-e',
    'send m to participant h of svc',
    '-e',
    'end tell',
    '-e',
    'end run',
    handle,
    text,
  ]);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const ownerEmail = process.env.SILKROAD_USER_EMAIL;
  if (!ownerEmail) {
    throw new Error('SILKROAD_USER_EMAIL must be set to the owner account email');
  }
  await connect();
  createModels(mongoose);
  const methods = createMethods(mongoose);
  startHeartbeat(methods, 'channel-imessage', 'iMessage connector', logger);
  const owner = await methods.findUser({ email: ownerEmail }, '_id');
  if (!owner) {
    throw new Error(`Owner user ${ownerEmail} not found`);
  }
  const sql = createSqlRunner();
  const ownHandles = resolveOwnHandles(sql, process.env.SILKROAD_AGENT_HANDLES || '');
  const gateway = gatewayClient();
  const deps = {
    gateway,
    sql,
    send: guardedSender(ownHandles, sendViaMessages),
    echo: createEchoGuard(),
    methods,
    chat: createBrainChat({ apiKey: process.env.OPENAI_API_KEY, json: false }),
    model,
    vaultPath,
    user: String(owner._id),
    ownHandles,
    logger,
  };

  let state = loadState();
  if (!state) {
    const max = maxRowId(sql);
    state = { lastRowId: Math.max(0, max - backfill) };
    saveState(state);
    logger.info(
      `[imessage] fresh start at ROWID ${state.lastRowId} (max ${max}, backfill ${backfill})`,
    );
  }
  logger.info(`[imessage] owner handles: ${[...ownHandles].join(', ') || '(none detected)'}`);
  logger.info(`[imessage] polling chat.db every ${intervalMs}ms for user ${deps.user}`);

  for (;;) {
    try {
      const next = await pollOnce(deps, state);
      if (next.lastRowId !== state.lastRowId) {
        state = next;
        saveState(state);
      }
    } catch (error) {
      logger.error('[imessage] poll failed', error);
    }
    if (process.env.INGEST_ONCE === 'true') {
      break;
    }
    await sleep(intervalMs);
  }
  await mongoose.disconnect();
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
