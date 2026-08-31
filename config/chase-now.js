/**
 * Runs the AR-chase workflow once for the owner and prints the result.
 * Overdue invoices are vault notes of type `invoice`; each gets one reminder
 * drafted for approval (sent automatically only once the workflow is
 * graduated). Without Gmail credentials the drafts land as approvals only.
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const { createModels, createMethods, logger } = require('@librechat/data-schemas');
const {
  runChase,
  createBrainChat,
  createGmailClient,
  createDraftPolicy,
  parseDraftDomains,
  createChannelAudit,
} = require('@librechat/api');
const connect = require('./connect');

const vaultPath = process.env.BRAIN_VAULT_PATH || path.resolve(__dirname, '..', 'brain');

function gmailApi(policy, ownerEmail) {
  const { GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN } = process.env;
  if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) {
    logger.warn('chase: Gmail not configured — chases will be recorded as approvals only');
    return undefined;
  }
  return createGmailClient({
    clientId: GMAIL_CLIENT_ID,
    clientSecret: GMAIL_CLIENT_SECRET,
    refreshToken: GMAIL_REFRESH_TOKEN,
    ownerEmail,
    policy,
  });
}

(async () => {
  const ownerEmail = process.env.SILKROAD_USER_EMAIL;
  if (!ownerEmail) {
    throw new Error('SILKROAD_USER_EMAIL is required');
  }
  await connect();
  createModels(mongoose);
  const methods = createMethods(mongoose);
  const owner = await methods.findUser({ email: ownerEmail }, '_id name username tenantId');
  if (!owner) {
    throw new Error(`Owner user ${ownerEmail} not found`);
  }
  const policy = createDraftPolicy({
    ownerEmail,
    allowedDomains: parseDraftDomains(process.env.SILKROAD_DRAFT_DOMAINS),
  });
  const result = await runChase(
    {
      vaultPath,
      methods,
      policy,
      audit: createChannelAudit(methods.recordAuditEntry, {
        tenantId: owner.tenantId ?? undefined,
        user: String(owner._id),
      }),
      api: gmailApi(policy, ownerEmail),
      chat: process.env.OPENAI_API_KEY
        ? createBrainChat({ apiKey: process.env.OPENAI_API_KEY })
        : undefined,
      model: process.env.BRAIN_ANSWER_MODEL || 'gpt-5.5',
      ownerName: owner.name || owner.username || 'the team',
      logger,
    },
    String(owner._id),
  );
  logger.info(`chase: ${JSON.stringify(result)}`);
  await mongoose.disconnect();
  process.exit(0);
})().catch((error) => {
  logger.error('chase: failed', error);
  process.exit(1);
});
