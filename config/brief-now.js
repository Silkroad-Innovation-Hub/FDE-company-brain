const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const { createModels, createMethods, logger } = require('@librechat/data-schemas');
const {
  createBrainChat,
  createCalendarClient,
  parseBudgetConfig,
  runBrief,
} = require('@librechat/api');
const connect = require('./connect');

const BRIEF_CHAT_TIMEOUT_MS = 45_000;

/** Calendar shares Gmail's OAuth client; absent credentials simply drop the "Today" section. */
function calendarClient() {
  const { GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN } = process.env;
  if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) {
    return undefined;
  }
  return createCalendarClient({
    clientId: GMAIL_CLIENT_ID,
    clientSecret: GMAIL_CLIENT_SECRET,
    refreshToken: GMAIL_REFRESH_TOKEN,
  });
}

(async () => {
  await connect();
  createModels(mongoose);
  const methods = createMethods(mongoose);
  const email = process.env.SILKROAD_USER_EMAIL;
  if (!email) {
    throw new Error('SILKROAD_USER_EMAIL is required');
  }
  const owner = await methods.findUser({ email }, '_id');
  if (!owner) {
    throw new Error(`Owner user ${email} not found`);
  }
  const result = await runBrief(
    {
      methods,
      budget: parseBudgetConfig(process.env),
      timeZone: process.env.SILKROAD_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone,
      logger,
      chat: process.env.OPENAI_API_KEY
        ? createBrainChat({
            apiKey: process.env.OPENAI_API_KEY,
            json: false,
            timeoutMs: BRIEF_CHAT_TIMEOUT_MS,
          })
        : undefined,
      model: process.env.BRIEF_MODEL,
      calendar: calendarClient(),
    },
    String(owner._id),
  );
  console.log(result.skipped ? '(brief disabled by policy)' : `\n${result.text}\n`);
  await mongoose.disconnect();
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
