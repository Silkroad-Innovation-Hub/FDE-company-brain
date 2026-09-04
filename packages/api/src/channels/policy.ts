import { extractAddress, extractAddresses } from './gmail/parse';

export interface DraftRecipients {
  to: string | string[];
  cc?: string | string[];
}

/**
 * Who the agent may draft mail to (brief §6: allowlisted domains for drafts).
 * The owner's own address is always allowed; an empty allowlist means
 * "owner only" — no domain is ever derived from the owner's address, because
 * on a public mailbox provider that would allow the whole of gmail.com.
 */
export interface DraftPolicy {
  ownerEmail: string;
  allowedDomains: string[];
  allowedAddresses: string[];
  isRecipientAllowed: (address: string) => boolean;
  assertRecipientsAllowed: (recipients: DraftRecipients) => void;
}

export class RecipientNotAllowedError extends Error {
  readonly domains: string[];

  constructor(domains: string[]) {
    super(`Recipient domain not allowlisted: ${domains.join(', ')}`);
    this.domains = domains;
  }
}

export function parseDraftDomains(env: string | undefined): string[] {
  return (env ?? '')
    .split(',')
    .map((domain) => domain.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
}

export function domainOf(address: string): string {
  const at = extractAddress(address).lastIndexOf('@');
  return at === -1 ? '' : extractAddress(address).slice(at + 1);
}

function matchesDomain(domain: string, allowed: string): boolean {
  return domain === allowed || domain.endsWith(`.${allowed}`);
}

function toList(value: string | string[] | undefined): string[] {
  if (value == null) {
    return [];
  }
  return Array.isArray(value) ? value.flatMap(extractAddresses) : extractAddresses(value);
}

export function createDraftPolicy(config: {
  ownerEmail: string;
  allowedDomains: string[];
  allowedAddresses?: string[];
}): DraftPolicy {
  const owner = extractAddress(config.ownerEmail);
  const allowedDomains = config.allowedDomains.map((domain) => domain.toLowerCase());
  const allowedAddresses = new Set([owner, ...(config.allowedAddresses ?? []).map(extractAddress)]);

  function isRecipientAllowed(address: string): boolean {
    const normalized = extractAddress(address);
    if (!normalized) {
      return false;
    }
    if (allowedAddresses.has(normalized)) {
      return true;
    }
    const domain = domainOf(normalized);
    return allowedDomains.some((allowed) => matchesDomain(domain, allowed));
  }

  function assertRecipientsAllowed(recipients: DraftRecipients): void {
    const all = [...toList(recipients.to), ...toList(recipients.cc)];
    const blocked = [...new Set(all.filter((address) => !isRecipientAllowed(address)))].map(
      (address) => domainOf(address) || address,
    );
    if (all.length === 0) {
      throw new RecipientNotAllowedError(['(no recipient)']);
    }
    if (blocked.length > 0) {
      throw new RecipientNotAllowedError([...new Set(blocked)]);
    }
  }

  return {
    ownerEmail: owner,
    allowedDomains,
    allowedAddresses: [...allowedAddresses],
    isRecipientAllowed,
    assertRecipientsAllowed,
  };
}
