/**
 * Photon iMessage connector (context/channels.md, "Photon"): the agent's own iMessage
 * number, provisioned in the cloud, no Mac required. Consumes the Photon stream,
 * appends the owner's texts to the `brainlogs` raw log (the distiller worker does the
 * model work) and answers them through the API gateway. Owner-only: the phone or
 * Apple ID in PHOTON_OWNER_HANDLE must be registered as a user of the Photon project.
 *
 * One-time setup: register the owner in the Photon dashboard, then `npm run photon:hello`.
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const { createModels, createMethods, logger } = require('@librechat/data-schemas');
const { createBrainChat, createGatewayClient, startPhotonConnector } = require('@librechat/api');
const { createPhotonClient } = require('@librechat/api/photon');
const connect = require('./connect');
const { startHeartbeat } = require('./heartbeat');

const vaultPath = process.env.BRAIN_VAULT_PATH || path.resolve(__dirname, '..', 'brain');
const noticeMs = Number(process.env.PHOTON_NOTICE_MS) || 15_000;
const model = process.env.BRAIN_ANSWER_MODEL || 'gpt-5.5';

/** Answers go through the API gateway (the web-chat agent) when a service token is configured. */
function gatewayClient() {
  const token = process.env.SILKROAD_SERVICE_TOKEN;
  if (!token) {
    logger.warn('[photon] SILKROAD_SERVICE_TOKEN unset — answering with the local chat fallback');
    return undefined;
  }
  return createGatewayClient({
    url: process.env.SILKROAD_API_URL || 'http://127.0.0.1:3080',
    token,
    timeoutMs: Number(process.env.SILKROAD_CHANNEL_TIMEOUT_MS) + 10_000 || undefined,
  });
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required (see context/channels.md, "Photon")`);
  }
  return value;
}

(async () => {
  const email = requireEnv('SILKROAD_USER_EMAIL');
  const projectId = requireEnv('PHOTON_PROJECT_ID');
  const projectSecret = requireEnv('PHOTON_PROJECT_SECRET');
  const handle = requireEnv('PHOTON_OWNER_HANDLE');
  await connect();
  createModels(mongoose);
  const methods = createMethods(mongoose);
  startHeartbeat(methods, 'channel-photon', 'Photon iMessage connector', logger);
  const owner = await methods.findUser({ email }, '_id');
  if (!owner) {
    throw new Error(`Owner user ${email} not found`);
  }
  const client = await createPhotonClient({ projectId, projectSecret, logger });
  const line = await client.lineFor(handle);
  const connector = startPhotonConnector({
    gateway: gatewayClient(),
    client,
    methods,
    chat: createBrainChat({ apiKey: process.env.OPENAI_API_KEY, json: false }),
    model,
    vaultPath,
    owner: { user: String(owner._id), handle },
    logger,
    noticeMs,
  });
  logger.info(`[photon] connector up: ${handle} texts ${line} (vault: ${vaultPath})`);
  await connector.done;
})().catch(async (error) => {
  logger.error('[photon] connector stopped', error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
