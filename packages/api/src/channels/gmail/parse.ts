export interface GmailHeader {
  name?: string | null;
  value?: string | null;
}

export interface GmailBody {
  data?: string | null;
  size?: number | null;
  attachmentId?: string | null;
}

export interface GmailPart {
  partId?: string | null;
  mimeType?: string | null;
  filename?: string | null;
  headers?: GmailHeader[];
  body?: GmailBody;
  parts?: GmailPart[];
}

/** The subset of a `users.messages.get(format=full)` response the connector reads. */
export interface GmailMessage {
  id?: string | null;
  threadId?: string | null;
  labelIds?: string[] | null;
  internalDate?: string | null;
  payload?: GmailPart;
}

export interface ParsedMail {
  messageId: string;
  threadId: string;
  from: string;
  fromAddress: string;
  /** Every To/Cc recipient, lowercased bare addresses. */
  to: string[];
  subject: string;
  date: Date;
  text: string;
  labels: string[];
  rfcMessageId?: string;
  references?: string;
  isBulk: boolean;
  isAgent: boolean;
  isSent: boolean;
}

export const AGENT_HEADER = 'X-Silkroad-Agent';

const BULK_LABELS = new Set([
  'CATEGORY_PROMOTIONS',
  'CATEGORY_SOCIAL',
  'CATEGORY_UPDATES',
  'SPAM',
  'TRASH',
]);
const BULK_PRECEDENCE = /^(bulk|list)$/i;
const QUOTE_START =
  /^(on .+ wrote:|-{2,}\s*(original|forwarded) message\s*-{2,}|begin forwarded message:)\s*$/i;
const FORWARD_HEADER = /^(from|sent|to|subject|date):\s/i;
const SIGNATURE_DELIMITER = /^--\s?$/;
const ENTITIES: Record<'amp' | 'lt' | 'gt' | 'quot' | 'apos' | 'nbsp', string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function header(part: GmailPart | undefined, name: string): string | undefined {
  const lower = name.toLowerCase();
  const match = part?.headers?.find((h) => h.name?.toLowerCase() === lower);
  return match?.value ?? undefined;
}

export function decodeBody(data: string | null | undefined): string {
  if (!data) {
    return '';
  }
  return Buffer.from(data, 'base64url').toString('utf8');
}

function decodeEntity(entity: string): string {
  if (entity.startsWith('#x') || entity.startsWith('#X')) {
    return String.fromCodePoint(parseInt(entity.slice(2), 16));
  }
  if (entity.startsWith('#')) {
    return String.fromCodePoint(parseInt(entity.slice(1), 10));
  }
  return entity in ENTITIES ? ENTITIES[entity as keyof typeof ENTITIES] : `&${entity};`;
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote|pre)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity: string) => decodeEntity(entity))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isForwardedHeaderBlock(lines: string[], index: number): boolean {
  let matched = 0;
  for (let i = index; i < lines.length && i < index + 5; i++) {
    if (!FORWARD_HEADER.test(lines[i])) {
      break;
    }
    matched += 1;
  }
  return matched >= 2;
}

/** Keeps only the new content: drops quoted history, forwarded blocks and the signature. */
export function stripQuotedHistory(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (
      QUOTE_START.test(trimmed) ||
      SIGNATURE_DELIMITER.test(line) ||
      isForwardedHeaderBlock(lines, i)
    ) {
      break;
    }
    if (trimmed.startsWith('>')) {
      continue;
    }
    kept.push(line);
  }
  return kept
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

interface BodyParts {
  plain: string[];
  html: string[];
  attachments: string[];
}

function collectParts(part: GmailPart | undefined, acc: BodyParts): BodyParts {
  if (!part) {
    return acc;
  }
  if (part.filename) {
    acc.attachments.push(part.filename);
  } else if (part.mimeType === 'text/plain' && part.body?.data) {
    acc.plain.push(decodeBody(part.body.data));
  } else if (part.mimeType === 'text/html' && part.body?.data) {
    acc.html.push(decodeBody(part.body.data));
  }
  for (const child of part.parts ?? []) {
    collectParts(child, acc);
  }
  return acc;
}

export function extractAddress(headerValue: string | undefined): string {
  if (!headerValue) {
    return '';
  }
  const angled = headerValue.match(/<([^>]+)>/);
  const raw = angled ? angled[1] : headerValue;
  return raw.trim().toLowerCase();
}

export function extractAddresses(headerValue: string | undefined): string[] {
  if (!headerValue) {
    return [];
  }
  return headerValue
    .split(',')
    .map((entry) => extractAddress(entry))
    .filter(Boolean);
}

function isBulkMail(payload: GmailPart | undefined, labels: string[]): boolean {
  if (labels.some((label) => BULK_LABELS.has(label))) {
    return true;
  }
  if (header(payload, 'List-Unsubscribe')) {
    return true;
  }
  return BULK_PRECEDENCE.test(header(payload, 'Precedence') ?? '');
}

export function parseGmailMessage(message: GmailMessage): ParsedMail | null {
  if (!message.id || !message.threadId) {
    return null;
  }
  const { payload } = message;
  const labels = message.labelIds ?? [];
  const parts = collectParts(payload, { plain: [], html: [], attachments: [] });
  const rawBody =
    parts.plain.length > 0 ? parts.plain.join('\n') : htmlToText(parts.html.join('\n'));
  const body = stripQuotedHistory(rawBody);
  const attachments =
    parts.attachments.length > 0 ? `(attachments: ${parts.attachments.join(', ')})` : '';
  const text = [body, attachments].filter(Boolean).join('\n\n');
  const from = header(payload, 'From') ?? '';
  const dateHeader = header(payload, 'Date');
  const date = message.internalDate
    ? new Date(Number(message.internalDate))
    : new Date(dateHeader ?? Date.now());
  return {
    messageId: message.id,
    threadId: message.threadId,
    from,
    fromAddress: extractAddress(from),
    to: [...extractAddresses(header(payload, 'To')), ...extractAddresses(header(payload, 'Cc'))],
    subject: header(payload, 'Subject') ?? '',
    date,
    text,
    labels,
    rfcMessageId: header(payload, 'Message-ID') ?? header(payload, 'Message-Id'),
    references: header(payload, 'References'),
    isBulk: isBulkMail(payload, labels),
    isAgent: header(payload, AGENT_HEADER) != null,
    isSent: labels.includes('SENT'),
  };
}
