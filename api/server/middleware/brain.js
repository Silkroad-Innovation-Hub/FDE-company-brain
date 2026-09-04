const path = require('path');
const { logger } = require('@librechat/data-schemas');
const {
  BRAIN_PLACEHOLDER,
  buildBrainSnapshot,
  injectBrainSnapshot,
  recentInbox,
  formatInbox,
} = require('@librechat/api');
const { draftPolicyFor, draftMailerFor } = require('~/server/services/drafts');
const { getTodos } = require('~/models');

const INBOX_LIMIT = 5;
const INBOX_TTL_MS = 60_000;
let inboxCache = { at: 0, text: '' };

/** The newest inbox emails as one block, cached briefly so texts stay fast. */
async function inboxBlock(ownerEmail) {
  if (Date.now() - inboxCache.at < INBOX_TTL_MS) {
    return inboxCache.text;
  }
  const mailer = draftMailerFor(draftPolicyFor(ownerEmail));
  if (!mailer) {
    return '';
  }
  try {
    const text = formatInbox(await recentInbox(mailer, INBOX_LIMIT));
    inboxCache = { at: Date.now(), text };
  } catch (error) {
    logger.error('[brain] inbox unavailable; snapshot continues without it', error);
    inboxCache = { at: Date.now(), text: '' };
  }
  return inboxCache.text;
}

const vaultPath = () =>
  process.env.BRAIN_VAULT_PATH || path.resolve(__dirname, '..', '..', '..', 'brain');

/**
 * Fills `{{silkroad_brain}}` in a model spec's promptPrefix with the live brain
 * snapshot (open to-dos + vault headline facts) so channel answers can skip the
 * brain_search round-trip. Prompts without the placeholder pass through untouched;
 * a snapshot failure degrades to an empty block rather than blocking the request.
 */
async function withBrainSnapshot(parsedBody, userId, ownerEmail) {
  const prompt = parsedBody?.promptPrefix;
  if (typeof BRAIN_PLACEHOLDER !== 'string' || typeof prompt !== 'string') {
    return parsedBody;
  }
  if (!prompt.includes(BRAIN_PLACEHOLDER)) {
    return parsedBody;
  }
  let snapshot = '';
  try {
    const [todos, inbox] = await Promise.all([getTodos(userId), inboxBlock(ownerEmail)]);
    snapshot = await buildBrainSnapshot(vaultPath(), todos, inbox);
  } catch (error) {
    logger.error('[brain] snapshot unavailable; answering without it', error);
  }
  return { ...parsedBody, promptPrefix: injectBrainSnapshot(prompt, snapshot) };
}

module.exports = { withBrainSnapshot };
