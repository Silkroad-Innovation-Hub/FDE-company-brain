const {
  createGmailClient,
  createDraftPolicy,
  parseDraftDomains,
  parseContacts,
} = require('@librechat/api');

/** Named contacts the owner refers to by first name (`SILKROAD_CONTACTS=Name=address,...`). */
function contactsFor() {
  return parseContacts(process.env.SILKROAD_CONTACTS);
}

/**
 * Draft-domain allowlist for the owner (brief §6); empty env = owner's own
 * address only. Named contacts are always allowed.
 */
function draftPolicyFor(ownerEmail) {
  return createDraftPolicy({
    ownerEmail: process.env.SILKROAD_USER_EMAIL || ownerEmail || '',
    allowedDomains: parseDraftDomains(process.env.SILKROAD_DRAFT_DOMAINS),
    allowedAddresses: contactsFor().map((contact) => contact.email),
  });
}

/** Gmail client for draft create/send/delete; null when the channel is not configured. */
function draftMailerFor(policy) {
  const { GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, SILKROAD_USER_EMAIL } =
    process.env;
  if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN || !SILKROAD_USER_EMAIL) {
    return null;
  }
  return createGmailClient({
    clientId: GMAIL_CLIENT_ID,
    clientSecret: GMAIL_CLIENT_SECRET,
    refreshToken: GMAIL_REFRESH_TOKEN,
    ownerEmail: SILKROAD_USER_EMAIL,
    policy,
  });
}

module.exports = { contactsFor, draftPolicyFor, draftMailerFor };
