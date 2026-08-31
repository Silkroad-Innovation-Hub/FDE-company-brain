import type { ApprovalLean, ApprovalCreateData, AuditAction } from '@librechat/data-schemas';
import type { AuditEvent } from './audit';
import { draftEmailForApproval } from './drafts';
import { createDraftPolicy } from './policy';

function deps() {
  const approvals: ApprovalLean[] = [];
  const audits: Array<{ action: AuditAction; event: AuditEvent }> = [];
  const createDraft = jest.fn(async () => 'draft-42');
  return {
    approvals,
    audits,
    createDraft,
    deps: {
      api: { createDraft },
      policy: createDraftPolicy({ ownerEmail: 'me@gmail.com', allowedDomains: ['acme.com'] }),
      methods: {
        createApproval: async (user: string, data: ApprovalCreateData) => {
          const approval = {
            _id: `a${approvals.length + 1}`,
            user,
            status: 'pending',
            ...data,
          } as unknown as ApprovalLean;
          approvals.push(approval);
          return approval;
        },
        decideApproval: async (_user: string, id: string, status: 'approved' | 'denied') => {
          const found = approvals.find((a) => String(a._id) === id);
          if (!found) {
            return null;
          }
          const decided = { ...found, status } as ApprovalLean;
          approvals.splice(approvals.indexOf(found), 1, decided);
          return decided;
        },
      },
      audit: async (action: AuditAction, event: AuditEvent) => {
        audits.push({ action, event });
        return true;
      },
    },
  };
}

const request = {
  to: 'Dana <dana@ap.acme.com>',
  subject: 'Invoice 1042',
  body: 'Hi Dana…',
  title: 'Chase Henderson invoice',
  description: 'Draft ready — send?',
};

describe('draftEmailForApproval', () => {
  it('creates the draft, then a pending approval carrying its id, and audits creation', async () => {
    const d = deps();
    const result = await draftEmailForApproval(d.deps, 'u1', request);
    expect(result.blocked).toBe(false);
    expect(d.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({ to: request.to, subject: 'Invoice 1042', text: 'Hi Dana…' }),
    );
    expect(d.approvals[0]).toMatchObject({
      kind: 'email',
      status: 'pending',
      payload: { draftId: 'draft-42', to: request.to },
    });
    expect(d.audits).toEqual([
      expect.objectContaining({
        action: 'channel.draft_created',
        event: expect.objectContaining({
          target: { type: 'draft', id: 'draft-42' },
          metadata: { approvalId: 'a1', recipientDomain: 'ap.acme.com', hasCc: false },
        }),
      }),
    ]);
  });

  it('blocks disallowed recipients: no draft, a denied approval, and a blocked audit entry', async () => {
    const d = deps();
    const result = await draftEmailForApproval(d.deps, 'u1', {
      ...request,
      cc: 'boss@evil.io',
    });
    expect(result.blocked).toBe(true);
    if (result.blocked) {
      expect(result.domains).toEqual(['evil.io']);
    }
    expect(d.createDraft).not.toHaveBeenCalled();
    expect(d.approvals[0]).toMatchObject({ status: 'denied' });
    expect(d.approvals[0].payload.draftId).toBeUndefined();
    expect(d.approvals[0].description).toContain('evil.io');
    expect(d.audits[0]).toMatchObject({
      action: 'channel.draft_blocked',
      event: { outcome: 'denied', metadata: { blockedDomains: 'evil.io' } },
    });
  });
});
