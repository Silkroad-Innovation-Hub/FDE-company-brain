import type { AuditAction } from '@librechat/data-schemas';
import type { AuditEvent } from './audit';
import { applyDraftDecision } from './approval';
import { createDraftPolicy } from './policy';
import { ownerActor } from './audit';

const actor = ownerActor('u1', 'me@gmail.com');
const policy = createDraftPolicy({ ownerEmail: 'me@gmail.com', allowedDomains: ['acme.com'] });

function harness(recipients = { to: ['dana@acme.com'], cc: [] as string[] }) {
  const calls: string[] = [];
  const audits: Array<{ action: AuditAction; event: AuditEvent; failClosed?: boolean }> = [];
  const mailer = {
    sendDraft: jest.fn(async () => {
      calls.push('send');
      return 'msg-1';
    }),
    deleteDraft: jest.fn(async () => {
      calls.push('delete');
    }),
    getDraftRecipients: jest.fn(async () => recipients),
  };
  let failAudit = false;
  const audit = async (
    action: AuditAction,
    event: AuditEvent,
    options?: { failClosed?: boolean },
  ) => {
    calls.push(`audit:${action}:${event.outcome ?? 'success'}`);
    audits.push({ action, event, failClosed: options?.failClosed });
    if (failAudit && options?.failClosed) {
      throw new Error('audit store down');
    }
    return true;
  };
  return {
    calls,
    audits,
    mailer,
    deps: { mailer, policy, audit, actor },
    breakAudit: () => {
      failAudit = true;
    },
  };
}

describe('applyDraftDecision', () => {
  it('re-checks recipients, audits fail-closed before sending, then sends and confirms', async () => {
    const h = harness();
    const outcome = await applyDraftDecision(h.deps, {
      _id: 'a1',
      kind: 'email',
      status: 'approved',
      payload: { draftId: 'd1' },
    });
    expect(outcome).toBe('sent');
    expect(h.calls).toEqual([
      'audit:channel.draft_sent:pending',
      'send',
      'audit:channel.draft_sent:success',
    ]);
    expect(h.audits[0].failClosed).toBe(true);
    expect(h.audits[0].event.metadata).toEqual({
      approvalId: 'a1',
      recipientDomain: 'acme.com',
      recipientCount: 1,
    });
    expect(h.mailer.deleteDraft).not.toHaveBeenCalled();
  });

  it('does not send when the fail-closed audit write fails', async () => {
    const h = harness();
    h.breakAudit();
    await expect(
      applyDraftDecision(h.deps, { kind: 'email', status: 'approved', payload: { draftId: 'd1' } }),
    ).rejects.toThrow('audit store down');
    expect(h.mailer.sendDraft).not.toHaveBeenCalled();
  });

  it('blocks a draft whose recipients drifted off the allowlist and audits the block', async () => {
    const h = harness({ to: ['dana@acme.com'], cc: ['leak@evil.io'] });
    await expect(
      applyDraftDecision(h.deps, {
        _id: 'a2',
        kind: 'email',
        status: 'approved',
        payload: { draftId: 'd2' },
      }),
    ).rejects.toThrow(/evil.io/);
    expect(h.mailer.sendDraft).not.toHaveBeenCalled();
    expect(h.audits).toEqual([
      expect.objectContaining({
        action: 'channel.draft_blocked',
        event: expect.objectContaining({
          outcome: 'denied',
          metadata: { approvalId: 'a2', blockedDomains: 'evil.io' },
        }),
      }),
    ]);
  });

  it('deletes the draft on deny and audits the deletion', async () => {
    const h = harness();
    const outcome = await applyDraftDecision(h.deps, {
      _id: 'a3',
      kind: 'email',
      status: 'denied',
      payload: { draftId: 'd3' },
    });
    expect(outcome).toBe('deleted');
    expect(h.mailer.deleteDraft).toHaveBeenCalledWith('d3');
    expect(h.mailer.sendDraft).not.toHaveBeenCalled();
    expect(h.audits[0]).toMatchObject({ action: 'channel.draft_deleted' });
  });

  it('is inert for approvals without a draft and refuses to act without credentials', async () => {
    const h = harness();
    expect(
      await applyDraftDecision(h.deps, { kind: 'email', status: 'approved', payload: {} }),
    ).toBe('none');
    expect(
      await applyDraftDecision(h.deps, {
        kind: 'message',
        status: 'approved',
        payload: { draftId: 'd1' },
      }),
    ).toBe('none');
    expect(h.mailer.sendDraft).not.toHaveBeenCalled();
    expect(h.audits).toHaveLength(0);
    await expect(
      applyDraftDecision(
        { ...h.deps, mailer: null },
        { kind: 'email', status: 'approved', payload: { draftId: 'd1' } },
      ),
    ).rejects.toThrow('no Gmail credentials');
  });
});
