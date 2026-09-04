const { z } = require('zod');
const { logger } = require('@librechat/data-schemas');
const { tool } = require('@librechat/agents/langchain/tools');
const { Tools } = require('librechat-data-provider');
const { draftEmailForApproval, resolveContact, describeContacts } = require('@librechat/api');
const {
  contactsFor,
  draftPolicyFor,
  draftMailerFor,
  auditFor,
} = require('~/server/services/drafts');
const { createApproval, decideApproval } = require('~/models');

const emailDraftSchema = z.object({
  to: z.string().describe('Recipient email address (one address), or the name of a known contact.'),
  subject: z.string().describe('Short, specific subject line.'),
  body: z
    .string()
    .describe("Plain-text body in the owner's voice, ready to send. No placeholders."),
});

const PREVIEW_CHARS = 160;

function preview(body) {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS - 1)}…` : flat;
}

/**
 * Drafts an email in the owner's Gmail and queues it for approval — the only
 * way the agent can originate mail (brief §6). Nothing is sent here: the owner
 * approves from the dashboard or by texting "send", which runs the audited
 * `applyDraftDecision` path.
 *
 * @param {{ user?: { id: string, email?: string, tenantId?: string }, deps?: object }} params
 */
function createEmailDraftTool({ user, deps }) {
  const contacts = deps?.contacts ?? contactsFor();
  return tool(
    async ({ to: recipient, subject, body }) => {
      if (!user?.id) {
        return 'Email drafting is unavailable: no owner in this request.';
      }
      const to = resolveContact(contacts, recipient);
      const policy = draftPolicyFor(user.email);
      const api = deps?.api ?? draftMailerFor(policy);
      if (!api) {
        return 'Email drafting is not configured on this instance (Gmail credentials missing).';
      }
      try {
        const result = await draftEmailForApproval(
          {
            api,
            policy,
            methods: deps?.methods ?? { createApproval, decideApproval },
            audit: deps?.audit ?? auditFor(user).audit,
          },
          user.id,
          {
            to,
            subject,
            body,
            title: `Email to ${to}: ${subject}`,
            description: preview(body),
          },
        );
        if (result.blocked) {
          return `Blocked: ${result.domains.join(', ')} is not on the email allowlist, so no draft was created. Tell the owner plainly.`;
        }
        return `Draft created (not sent) to ${to}, subject "${subject}": ${preview(body)} — Tell the owner exactly what you drafted in one line and end with: Reply send to send it, or scrap it to delete.`;
      } catch (error) {
        logger.error(`[${Tools.email_draft}] draft failed`, error);
        return 'Drafting failed; tell the owner the email could not be drafted right now.';
      }
    },
    {
      name: Tools.email_draft,
      description:
        "Drafts an email in the owner's Gmail and queues it for the owner's approval; nothing is sent until the owner says send. Use when the owner asks to email, reply to, or message someone. Write the full body yourself." +
        describeContacts(contacts),
      schema: emailDraftSchema,
    },
  );
}

module.exports = { createEmailDraftTool, emailDraftSchema };
