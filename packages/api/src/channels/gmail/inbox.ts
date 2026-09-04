import type { GmailApi } from './client';
import { parseGmailMessage } from './parse';

export interface InboxItem {
  from: string;
  subject: string;
  date: Date;
  preview: string;
}

const PREVIEW_CHARS = 160;

function previewOf(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS - 1)}…` : flat;
}

/** The newest inbox messages, parsed to what a one-line summary needs. */
export async function recentInbox(
  api: Pick<GmailApi, 'listInbox' | 'getMessage'>,
  limit: number,
): Promise<InboxItem[]> {
  const ids = await api.listInbox(limit);
  const messages = await Promise.all(ids.map((id) => api.getMessage(id)));
  return messages
    .map(parseGmailMessage)
    .filter((mail): mail is NonNullable<typeof mail> => mail != null)
    .map((mail) => ({
      from: mail.from,
      subject: mail.subject || '(no subject)',
      date: mail.date,
      preview: previewOf(mail.text),
    }));
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** One line per email, newest first, for the brain snapshot. */
export function formatInbox(items: InboxItem[]): string {
  if (items.length === 0) {
    return 'Inbox: no recent email.';
  }
  const lines = items.map(
    (item, index) =>
      `${index + 1}. ${formatDate(item.date)} · ${item.from} · ${item.subject}: ${item.preview}`,
  );
  return `Inbox (newest ${items.length}, from the owner's Gmail):\n${lines.join('\n')}`;
}
