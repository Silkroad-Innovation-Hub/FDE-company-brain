import { extractAddress } from './gmail/parse';

export interface Contact {
  name: string;
  email: string;
}

/**
 * Parses `SILKROAD_CONTACTS` — `Name=address, Other Name=address` — into the
 * owner's named contacts. The agent resolves first names to these addresses
 * when drafting mail, and each address is exempt from the domain allowlist.
 */
export function parseContacts(env: string | undefined): Contact[] {
  return (env ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const eq = entry.indexOf('=');
      if (eq === -1) {
        return null;
      }
      const name = entry.slice(0, eq).trim();
      const email = extractAddress(entry.slice(eq + 1));
      return name && email ? { name, email } : null;
    })
    .filter((contact): contact is Contact => contact !== null);
}

/** Resolves a name to a contact address; anything that already looks like an address passes through. */
export function resolveContact(contacts: Contact[], recipient: string): string {
  const trimmed = recipient.trim();
  if (trimmed.includes('@')) {
    return trimmed;
  }
  const wanted = trimmed.toLowerCase();
  const match = contacts.find((contact) => contact.name.toLowerCase() === wanted);
  return match ? match.email : trimmed;
}

export function describeContacts(contacts: Contact[]): string {
  if (contacts.length === 0) {
    return '';
  }
  return ` Known contacts: ${contacts.map((c) => `${c.name} = ${c.email}`).join('; ')}. When the owner names one of them, use that address.`;
}
