const { Tools } = require('librechat-data-provider');

jest.mock('~/models', () => ({ createApproval: jest.fn(), decideApproval: jest.fn() }));
jest.mock('~/server/services/drafts', () => ({
  contactsFor: () => [{ name: 'Dana', email: 'dana@henderson.com' }],
  draftPolicyFor: () =>
    require('@librechat/api').createDraftPolicy({
      ownerEmail: 'owner@example.com',
      allowedDomains: [],
      allowedAddresses: ['dana@henderson.com'],
    }),
  draftMailerFor: () => null,
  auditFor: () => ({ audit: async () => undefined }),
}));

const { createEmailDraftTool } = require('./emailDraft');

const user = { id: 'u1', email: 'owner@example.com' };

function fakeDeps() {
  const approvals = [];
  return {
    approvals,
    api: { createDraft: jest.fn(async () => 'draft-1') },
    methods: {
      createApproval: jest.fn(async (owner, data) => {
        const approval = {
          _id: `a${approvals.length + 1}`,
          user: owner,
          status: 'pending',
          ...data,
        };
        approvals.push(approval);
        return approval;
      }),
      decideApproval: jest.fn(async (_owner, id, status) => {
        const approval = approvals.find((a) => a._id === id);
        approval.status = status;
        return approval;
      }),
    },
    audit: jest.fn(async () => undefined),
  };
}

const call = (tool, input) => tool.invoke(input);

describe('email_draft tool', () => {
  it('drafts to a known contact by first name and asks the owner to send', async () => {
    const deps = fakeDeps();
    const tool = createEmailDraftTool({ user, deps });
    expect(tool.name).toBe(Tools.email_draft);
    const text = await call(tool, {
      to: 'Dana',
      subject: 'Invoice 1042',
      body: 'Hi Dana, quick nudge on invoice 1042 — could you confirm timing?',
    });
    expect(deps.api.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'dana@henderson.com', subject: 'Invoice 1042' }),
    );
    expect(deps.approvals[0]).toMatchObject({
      kind: 'email',
      status: 'pending',
      payload: expect.objectContaining({ draftId: 'draft-1', to: 'dana@henderson.com' }),
    });
    expect(text).toMatch(/Draft created \(not sent\) to dana@henderson.com/);
    expect(text).toMatch(/Reply send to send it/);
  });

  it('never drafts to a domain outside the allowlist', async () => {
    const deps = fakeDeps();
    const tool = createEmailDraftTool({ user, deps });
    const text = await call(tool, { to: 'ceo@stranger.io', subject: 'Hi', body: 'Hello' });
    expect(deps.api.createDraft).not.toHaveBeenCalled();
    expect(deps.approvals[0].status).toBe('denied');
    expect(text).toMatch(/Blocked: stranger.io/);
  });

  it('degrades to a plain message without Gmail credentials', async () => {
    const tool = createEmailDraftTool({ user });
    expect(await call(tool, { to: 'Dana', subject: 's', body: 'b' })).toMatch(/not configured/);
  });
});
