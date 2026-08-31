/**
 * One-time Gmail OAuth consent for the Silkroad connector (npm run gmail:auth).
 * Prints a consent URL, catches the redirect on localhost, and prints the
 * GMAIL_REFRESH_TOKEN line to add to .env.
 *
 * Prerequisite: a Google Cloud OAuth client of type "Desktop app" with the
 * Gmail API enabled; put its id/secret in GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET.
 */
const http = require('http');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const { auth } = require('@googleapis/gmail');
const { GMAIL_SCOPES, CALENDAR_SCOPE } = require('@librechat/api');

const PORT = Number(process.env.GMAIL_AUTH_PORT) || 53682;
const REDIRECT = `http://127.0.0.1:${PORT}/`;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is not set in .env`);
    process.exit(1);
  }
  return value;
}

const client = new auth.OAuth2(
  requireEnv('GMAIL_CLIENT_ID'),
  requireEnv('GMAIL_CLIENT_SECRET'),
  REDIRECT,
);

const url = client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: [...GMAIL_SCOPES, CALENDAR_SCOPE],
});

const server = http.createServer(async (req, res) => {
  const code = new URL(req.url, REDIRECT).searchParams.get('code');
  if (!code) {
    res.writeHead(400).end('Missing code');
    return;
  }
  try {
    const { tokens } = await client.getToken(code);
    res
      .writeHead(200, { 'Content-Type': 'text/plain' })
      .end('Silkroad: Gmail connected. You can close this tab.');
    if (!tokens.refresh_token) {
      console.error(
        'No refresh token returned — revoke the app at myaccount.google.com/permissions and retry.',
      );
      process.exit(1);
    }
    console.log('\nAdd this to .env:\n');
    console.log(`GMAIL_REFRESH_TOKEN=${tokens.refresh_token}\n`);
    console.log(
      'Note: if the OAuth consent screen is still in "Testing" status, this token expires after 7 days.\n' +
        'Publish the consent screen (In production) or use a Workspace-internal app to keep it.',
    );
  } catch (error) {
    res.writeHead(500).end('Token exchange failed');
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('Open this URL in your browser and approve access:\n');
  console.log(url);
  console.log(`\nWaiting for the redirect on ${REDIRECT} ...`);
});
