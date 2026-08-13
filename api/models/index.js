const mongoose = require('mongoose');
const { createMethods, logger } = require('@librechat/data-schemas');
const {
  matchModelName,
  findMatchingPattern,
  isDeploymentSkillId,
  toBrainCandidate,
} = require('@librechat/api');
const getLogStores = require('~/cache/getLogStores');

const methods = createMethods(mongoose, {
  matchModelName,
  findMatchingPattern,
  isExternalSkillId: isDeploymentSkillId,
  getCache: getLogStores,
});

const seedDatabase = async () => {
  await methods.initializeRoles();
  await methods.seedDefaultRoles();
  await methods.ensureDefaultCategories();
  await methods.seedSystemGrants();
};

/**
 * Every durable chat message also lands in the brain raw log (fire-and-forget,
 * so the reply path never waits on ingestion). The distiller worker consumes
 * the log asynchronously — see context/ingestion.md.
 */
const saveMessage = async (ctx, params, metadata) => {
  const saved = await methods.saveMessage(ctx, params, metadata);
  if (saved != null) {
    const candidate = toBrainCandidate(params, ctx?.isTemporary);
    if (candidate != null) {
      methods
        .appendBrainLog(ctx.userId, candidate)
        .catch((error) => logger.warn(`brain: raw-log append failed: ${error?.message}`));
    }
  }
  return saved;
};

module.exports = {
  ...methods,
  saveMessage,
  seedDatabase,
};
