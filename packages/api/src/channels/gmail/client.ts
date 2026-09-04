import { gmail, auth } from '@googleapis/gmail';
import type { gmail_v1 } from '@googleapis/gmail';
import type { GmailMessage } from './parse';
import type { DraftPolicy } from '~/channels/policy';
import { AGENT_HEADER, extractAddress, extractAddresses } from './parse';

/** Read-only inbox plus drafts/send — never `gmail.modify` (brief §6: read-only by default). */
export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
] as const;

export class HistoryExpiredError extends Error {}

export class RecipientNotOwnerError extends Error {}

export interface GmailProfile {
  emailAddress: string;
  historyId: string;
}

export interface GmailHistorySync {
  messageIds: string[];
  historyId: string;
}

export interface GmailOutgoing {
  to: string;
  cc?: string;
  subject: string;
  text: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string;
}

export interface GmailApi {
  getProfile: () => Promise<GmailProfile>;
  listHistory: (startHistoryId: string) => Promise<GmailHistorySync>;
  listRecent: (maxResults: number) => Promise<string[]>;
  /** Newest inbox messages regardless of age (for the brain snapshot). */
  listInbox: (maxResults: number) => Promise<string[]>;
  getMessage: (id: string) => Promise<GmailMessage>;
  /** Owner-only: throws `RecipientNotOwnerError` for any other address. */
  sendReply: (reply: GmailOutgoing) => Promise<string>;
  /** Policy-guarded: throws `RecipientNotAllowedError` before any API call. */
  createDraft: (draft: GmailOutgoing) => Promise<string>;
  sendDraft: (draftId: string) => Promise<string>;
  deleteDraft: (draftId: string) => Promise<void>;
  getDraftRecipients: (draftId: string) => Promise<GmailDraftRecipients>;
}

export interface GmailDraftRecipients {
  to: string[];
  cc: string[];
}

export interface GmailClientConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  ownerEmail: string;
  /** Draft-domain allowlist (context/unification.md §3.2); drafts are refused without one. */
  policy?: DraftPolicy;
}

const RECENT_QUERY = 'newer_than:2d -in:spam -in:trash';
const INBOX_QUERY = 'in:inbox -in:spam -in:trash';
const HISTORY_PAGE_SIZE = 500;

export function assertOwnerRecipient(ownerEmail: string, to: string): void {
  if (extractAddress(to) !== extractAddress(ownerEmail)) {
    throw new RecipientNotOwnerError(`Refusing to send to non-owner recipient: ${to}`);
  }
}

function encodeSubject(subject: string): string {
  return /^[\x20-\x7e]*$/.test(subject)
    ? subject
    : `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`;
}

/** RFC 2822 message with the agent marker header, base64url-encoded for the API. */
export function buildRawMessage(message: GmailOutgoing): string {
  const lines = [
    `To: ${message.to}`,
    ...(message.cc ? [`Cc: ${message.cc}`] : []),
    `Subject: ${encodeSubject(message.subject)}`,
    `${AGENT_HEADER}: 1`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
  ];
  if (message.inReplyTo) {
    lines.push(`In-Reply-To: ${message.inReplyTo}`);
    lines.push(`References: ${[message.references, message.inReplyTo].filter(Boolean).join(' ')}`);
  }
  return Buffer.from(`${lines.join('\r\n')}\r\n\r\n${message.text}`, 'utf8').toString('base64url');
}

function isNotFound(error: unknown): boolean {
  const status = (error as { code?: number | string; status?: number }).code;
  return status === 404 || status === '404' || (error as { status?: number }).status === 404;
}

export function createGmailClient(config: GmailClientConfig): GmailApi {
  const oauth = new auth.OAuth2(config.clientId, config.clientSecret);
  oauth.setCredentials({ refresh_token: config.refreshToken });
  const api: gmail_v1.Gmail = gmail({ version: 'v1', auth: oauth });
  const userId = 'me';

  async function getProfile(): Promise<GmailProfile> {
    const { data } = await api.users.getProfile({ userId });
    return { emailAddress: data.emailAddress ?? '', historyId: String(data.historyId ?? '') };
  }

  async function listHistory(startHistoryId: string): Promise<GmailHistorySync> {
    const ids = new Set<string>();
    let pageToken: string | undefined;
    let historyId = startHistoryId;
    do {
      let data: gmail_v1.Schema$ListHistoryResponse;
      try {
        ({ data } = await api.users.history.list({
          userId,
          startHistoryId,
          historyTypes: ['messageAdded'],
          maxResults: HISTORY_PAGE_SIZE,
          pageToken,
        }));
      } catch (error) {
        if (isNotFound(error)) {
          throw new HistoryExpiredError(`Gmail history ${startHistoryId} has expired`);
        }
        throw error;
      }
      for (const record of data.history ?? []) {
        for (const added of record.messagesAdded ?? []) {
          if (added.message?.id) {
            ids.add(added.message.id);
          }
        }
      }
      historyId = String(data.historyId ?? historyId);
      pageToken = data.nextPageToken ?? undefined;
    } while (pageToken);
    return { messageIds: [...ids], historyId };
  }

  async function listRecent(maxResults: number): Promise<string[]> {
    const { data } = await api.users.messages.list({ userId, q: RECENT_QUERY, maxResults });
    return (data.messages ?? []).map((m) => m.id).filter((id): id is string => Boolean(id));
  }

  async function listInbox(maxResults: number): Promise<string[]> {
    const { data } = await api.users.messages.list({ userId, q: INBOX_QUERY, maxResults });
    return (data.messages ?? []).map((m) => m.id).filter((id): id is string => Boolean(id));
  }

  async function getMessage(id: string): Promise<GmailMessage> {
    const { data } = await api.users.messages.get({ userId, id, format: 'full' });
    return data as GmailMessage;
  }

  async function sendReply(reply: GmailOutgoing): Promise<string> {
    assertOwnerRecipient(config.ownerEmail, reply.to);
    const { data } = await api.users.messages.send({
      userId,
      requestBody: { raw: buildRawMessage(reply), threadId: reply.threadId },
    });
    return data.id ?? '';
  }

  async function createDraft(draft: GmailOutgoing): Promise<string> {
    if (!config.policy) {
      throw new Error('Gmail drafts require a draft policy (SILKROAD_DRAFT_DOMAINS)');
    }
    config.policy.assertRecipientsAllowed({ to: draft.to, cc: draft.cc });
    const { data } = await api.users.drafts.create({
      userId,
      requestBody: { message: { raw: buildRawMessage(draft), threadId: draft.threadId } },
    });
    return data.id ?? '';
  }

  async function sendDraft(draftId: string): Promise<string> {
    const { data } = await api.users.drafts.send({ userId, requestBody: { id: draftId } });
    return data.id ?? '';
  }

  async function deleteDraft(draftId: string): Promise<void> {
    await api.users.drafts.delete({ userId, id: draftId });
  }

  async function getDraftRecipients(draftId: string): Promise<GmailDraftRecipients> {
    const { data } = await api.users.drafts.get({ userId, id: draftId, format: 'metadata' });
    const headers = data.message?.payload?.headers ?? [];
    const value = (name: string): string | undefined =>
      headers.find((h) => h.name?.toLowerCase() === name)?.value ?? undefined;
    return { to: extractAddresses(value('to')), cc: extractAddresses(value('cc')) };
  }

  return {
    getProfile,
    listHistory,
    listRecent,
    listInbox,
    getMessage,
    sendReply,
    createDraft,
    sendDraft,
    deleteDraft,
    getDraftRecipients,
  };
}
