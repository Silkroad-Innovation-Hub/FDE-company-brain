const path = require('path');
const { logger } = require('@librechat/data-schemas');
const { BRAIN_PLACEHOLDER, buildBrainSnapshot, injectBrainSnapshot } = require('@librechat/api');
const { getTodos } = require('~/models');

const vaultPath = () =>
  process.env.BRAIN_VAULT_PATH || path.resolve(__dirname, '..', '..', '..', 'brain');

/**
 * Fills `{{silkroad_brain}}` in a model spec's promptPrefix with the live brain
 * snapshot (open to-dos + vault headline facts) so channel answers can skip the
 * brain_search round-trip. Prompts without the placeholder pass through untouched;
 * a snapshot failure degrades to an empty block rather than blocking the request.
 */
async function withBrainSnapshot(parsedBody, userId) {
  const prompt = parsedBody?.promptPrefix;
  if (typeof BRAIN_PLACEHOLDER !== 'string' || typeof prompt !== 'string') {
    return parsedBody;
  }
  if (!prompt.includes(BRAIN_PLACEHOLDER)) {
    return parsedBody;
  }
  let snapshot = '';
  try {
    const todos = await getTodos(userId);
    snapshot = await buildBrainSnapshot(vaultPath(), todos);
  } catch (error) {
    logger.error('[brain] snapshot unavailable; answering without it', error);
  }
  return { ...parsedBody, promptPrefix: injectBrainSnapshot(prompt, snapshot) };
}

module.exports = { withBrainSnapshot };
