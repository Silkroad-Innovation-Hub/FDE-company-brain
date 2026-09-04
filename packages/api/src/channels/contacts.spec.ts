import { parseContacts, resolveContact, describeContacts } from './contacts';

describe('contacts', () => {
  const contacts = parseContacts(
    ' Feruza=feruza.ieva@gmail.com , Dana Lee = Dana <DANA@acme.com>, broken, =x@y.z',
  );

  it('parses Name=address pairs and drops malformed entries', () => {
    expect(contacts).toEqual([
      { name: 'Feruza', email: 'feruza.ieva@gmail.com' },
      { name: 'Dana Lee', email: 'dana@acme.com' },
    ]);
    expect(parseContacts(undefined)).toEqual([]);
  });

  it('resolves names case-insensitively and passes addresses through', () => {
    expect(resolveContact(contacts, 'feruza')).toBe('feruza.ieva@gmail.com');
    expect(resolveContact(contacts, 'Dana Lee')).toBe('dana@acme.com');
    expect(resolveContact(contacts, 'someone@else.com')).toBe('someone@else.com');
    expect(resolveContact(contacts, 'Nobody')).toBe('Nobody');
  });

  it('describes contacts for the tool prompt', () => {
    expect(describeContacts([])).toBe('');
    expect(describeContacts(contacts)).toContain('Feruza = feruza.ieva@gmail.com');
  });
});
