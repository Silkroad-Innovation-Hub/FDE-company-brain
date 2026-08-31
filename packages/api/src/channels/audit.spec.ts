import { createChannelAudit, AGENT_ACTOR, AuditUnavailableError } from './audit';

describe('createChannelAudit', () => {
  it('stamps the owner into metadata so owner-scoped views include agent actors', async () => {
    const recordAuditEntry = jest.fn(async () => ({ id: 'a1' }) as never);
    const audit = createChannelAudit(recordAuditEntry, { user: 'u1', tenantId: 't1' });
    await audit('channel.reply_sent', {
      actor: AGENT_ACTOR,
      target: { type: 'imessage', id: 'chat-1' },
      metadata: { chars: 42 },
    });
    expect(recordAuditEntry).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't1', metadata: { user: 'u1', chars: 42 } }),
      undefined,
    );
    await audit('channel.paused', {
      actor: AGENT_ACTOR,
      target: { type: 'channels', id: 'u1' },
      metadata: { user: 'explicit' },
    });
    expect(recordAuditEntry).toHaveBeenLastCalledWith(
      expect.objectContaining({ metadata: { user: 'explicit' } }),
      undefined,
    );
  });

  it('fails open by default and closed when asked', async () => {
    const audit = createChannelAudit(undefined, { user: 'u1' });
    expect(await audit('channel.paused', { actor: AGENT_ACTOR, target: { type: 'x' } })).toBe(
      false,
    );
    await expect(
      audit(
        'channel.draft_sent',
        { actor: AGENT_ACTOR, target: { type: 'x' } },
        { failClosed: true },
      ),
    ).rejects.toBeInstanceOf(AuditUnavailableError);
  });
});
