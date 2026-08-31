const express = require('express');
const { logger } = require('@librechat/data-schemas');
const {
  answerViaChat,
  isValidServiceToken,
  GatewayPausedError,
  createChannelAudit,
} = require('@librechat/api');
const {
  findUser,
  generateToken,
  getChannelThread,
  upsertChannelThread,
  isChannelsPaused,
  recordAuditEntry,
  saveConvo,
} = require('~/models');

const router = express.Router();

const SURFACES = new Set(['imessage', 'email']);
const OWNER_TOKEN_TTL_MS = 5 * 60_000;
const DEFAULT_SPEC = 'silkroad';

let ownerCache = null;

async function resolveOwner() {
  const email = process.env.SILKROAD_USER_EMAIL;
  if (!email) {
    return null;
  }
  if (ownerCache && ownerCache.email === email) {
    return ownerCache.user;
  }
  const user = await findUser({ email }, '_id email username provider tenantId');
  ownerCache = user ? { email, user } : null;
  return user;
}

/** Connector auth: shared per-instance secret, never a user session. */
function requireServiceToken(req, res, next) {
  if (!isValidServiceToken(req.headers.authorization, process.env.SILKROAD_SERVICE_TOKEN)) {
    return res.status(401).json({ error: 'Invalid service token' });
  }
  next();
}

/** Loopback to this same server; honours HOST so an IPv6-only `localhost` bind still works. */
function baseUrl() {
  const port = Number.isNaN(Number(process.env.PORT)) ? 3080 : Number(process.env.PORT);
  const host = process.env.HOST || 'localhost';
  return process.env.SILKROAD_LOOPBACK_URL || `http://${host}:${port}`;
}

router.use(requireServiceToken);

router.post('/answer', async (req, res) => {
  const { surface, externalThreadId, question, sender, subject, format } = req.body ?? {};
  if (
    !SURFACES.has(surface) ||
    typeof externalThreadId !== 'string' ||
    typeof question !== 'string'
  ) {
    return res.status(400).json({ error: 'surface, externalThreadId and question are required' });
  }
  try {
    const owner = await resolveOwner();
    if (!owner) {
      return res.status(503).json({ error: 'SILKROAD_USER_EMAIL is not configured or not found' });
    }
    const userId = String(owner._id);
    const answer = await answerViaChat(
      {
        baseUrl: baseUrl(),
        ownerToken: () => generateToken(owner, OWNER_TOKEN_TTL_MS),
        methods: {
          getChannelThread,
          upsertChannelThread,
          isChannelsPaused,
          setConversationTitle: (user, conversationId, title) =>
            saveConvo({ userId: user }, { conversationId, title }, { context: 'channels' }),
        },
        spec: process.env.SILKROAD_CHANNEL_SPEC || DEFAULT_SPEC,
        endpoint: 'openAI',
        logger,
        timeoutMs: Number(process.env.SILKROAD_CHANNEL_TIMEOUT_MS) || undefined,
        audit: createChannelAudit(recordAuditEntry, { tenantId: owner.tenantId ?? undefined }),
      },
      { user: userId, surface, externalThreadId, question, sender, subject, format },
    );
    res.status(200).json(answer);
  } catch (error) {
    if (error instanceof GatewayPausedError) {
      return res.status(423).json({ error: 'paused' });
    }
    logger.error('[channels] answer failed:', error);
    res.status(502).json({ error: error?.message ?? 'answer failed' });
  }
});

module.exports = router;
