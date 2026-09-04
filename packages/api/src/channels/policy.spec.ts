import { createDraftPolicy, parseDraftDomains, domainOf, RecipientNotAllowedError } from './policy';

describe('draft policy', () => {
  it('defaults to owner-only and never derives a domain from the owner address', () => {
    const policy = createDraftPolicy({ ownerEmail: 'Owner <Me@Gmail.com>', allowedDomains: [] });
    expect(policy.isRecipientAllowed('me@gmail.com')).toBe(true);
    expect(policy.isRecipientAllowed('someone-else@gmail.com')).toBe(false);
    expect(() => policy.assertRecipientsAllowed({ to: 'me@gmail.com' })).not.toThrow();
    expect(() => policy.assertRecipientsAllowed({ to: 'stranger@gmail.com' })).toThrow(
      RecipientNotAllowedError,
    );
  });

  it('allows allowlisted domains and their subdomains, case-insensitively, incl. cc', () => {
    const policy = createDraftPolicy({
      ownerEmail: 'me@gmail.com',
      allowedDomains: parseDraftDomains(' Acme.com, @henderson.co '),
    });
    expect(policy.allowedDomains).toEqual(['acme.com', 'henderson.co']);
    expect(policy.isRecipientAllowed('Dana Lee <DANA@ap.acme.com>')).toBe(true);
    expect(policy.isRecipientAllowed('x@notacme.com')).toBe(false);
    expect(() =>
      policy.assertRecipientsAllowed({ to: 'a@acme.com, b@henderson.co', cc: ['me@gmail.com'] }),
    ).not.toThrow();
    let caught: RecipientNotAllowedError | undefined;
    try {
      policy.assertRecipientsAllowed({ to: 'a@acme.com', cc: 'c@evil.io, d@evil.io' });
    } catch (error) {
      caught = error as RecipientNotAllowedError;
    }
    expect(caught?.domains).toEqual(['evil.io']);
    expect(() => policy.assertRecipientsAllowed({ to: [] })).toThrow(/no recipient/);
  });

  it('exempts named contact addresses from the domain allowlist', () => {
    const policy = createDraftPolicy({
      ownerEmail: 'me@gmail.com',
      allowedDomains: [],
      allowedAddresses: ['Feruza <Feruza.Ieva@gmail.com>'],
    });
    expect(policy.isRecipientAllowed('feruza.ieva@gmail.com')).toBe(true);
    expect(policy.isRecipientAllowed('other@gmail.com')).toBe(false);
  });

  it('extracts domains for audit metadata', () => {
    expect(domainOf('Dana <dana@AP.Acme.com>')).toBe('ap.acme.com');
    expect(domainOf('nonsense')).toBe('');
  });
});
