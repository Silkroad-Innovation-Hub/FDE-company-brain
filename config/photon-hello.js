/**
 * One-shot Photon onboarding (`npm run photon:hello`): texts the owner from the agent's
 * iMessage number with the agent's contact card and a greeting, and prints the number.
 * The owner taps the card to save the contact, then texts it — that is the whole setup.
 *
 * Counts as one of the free tier's 50 new conversations per line per day.
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const { createPhotonClient } = require('@librechat/api/photon');

const GREETING =
  "Hi — this is your Silkroad assistant. Save this number and text me anytime; I'll answer from your company brain.";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required (see context/channels.md, "Photon")`);
  }
  return value;
}

(async () => {
  const projectId = requireEnv('PHOTON_PROJECT_ID');
  const projectSecret = requireEnv('PHOTON_PROJECT_SECRET');
  const handle = requireEnv('PHOTON_OWNER_HANDLE');
  const client = await createPhotonClient({ projectId, projectSecret, logger: console });
  const line = await client.lineFor(handle);
  await client.shareContactCard(handle);
  await client.send(handle, GREETING);
  const number = line === 'shared' ? 'the number that just texted you' : line;
  console.log(`Sent the contact card and a greeting to ${handle} from ${number}.`);
  console.log(`Tap the card to save ${number}. On a Mac that also runs channel:imessage, add`);
  console.log('IMESSAGE_IGNORE_CHATS=<that number> so the same thread is not logged twice.');
  await client.stop();
  process.exit(0);
})().catch((error) => {
  console.error('[photon] hello failed', error);
  process.exit(1);
});
