import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import type { ApprovalLean, ApprovalCreateData, WorkflowPolicyLean } from '@librechat/data-schemas';
import type { GmailOutgoing } from '~/channels/gmail/client';
import type { ChaseMethods, ChaseDeps, OverdueInvoice } from './chase';
import { findOverdueInvoices, composeChase, chaseTemplate, runChase } from './chase';
import { createDraftPolicy } from '~/channels/policy';
import { NOOP_AUDIT } from '~/channels/audit';
import { loadVault } from '~/brain/vault';

const NOW = new Date('2026-08-30T12:00:00Z');
const OWNER = 'owner@example.com';

function note(fields: Record<string, string>, body: string): string {
  const lines = Object.entries(fields).map(([key, value]) => `${key}: ${value}`);
  return `---\ntype: invoice\ntags: [receivable]\n${lines.join('\n')}\n---\n\n${body}\n`;
}

async function makeVault(): Promise<string> {
  const vaultPath = await fs.mkdtemp(path.join(os.tmpdir(), 'chase-vault-'));
  await fs.writeFile(
    path.join(vaultPath, 'Henderson Invoice 1042.md'),
    note(
      {
        status: 'overdue',
        invoice: '1042',
        amount: '12400',
        currency: 'USD',
        due: '2026-08-01',
        company: 'Henderson Logistics',
        contact: 'Dana Lee',
        email: 'dana@henderson.example.com',
      },
      'Retainer invoice.',
    ),
  );
  await fs.writeFile(
    path.join(vaultPath, 'Northwind Invoice 0311.md'),
    note(
      {
        status: 'open',
        invoice: '0311',
        amount: '4800',
        due: '2026-09-20',
        company: 'Northwind Traders',
        contact: 'Sam Okafor',
        email: 'sam@northwind.example.com',
      },
      'Workshop invoice.',
    ),
  );
  await fs.writeFile(
    path.join(vaultPath, 'Old Paid 0001.md'),
    note(
      { status: 'paid', invoice: '0001', amount: '900', due: '2026-01-01', email: 'x@paid.com' },
      'Paid.',
    ),
  );
  await fs.writeFile(
    path.join(vaultPath, 'Acme.md'),
    '---\ntype: company\ntags: [client]\n---\n\nA client, not an invoice.\n',
  );
  return vaultPath;
}

function fakeMethods(initialPolicy?: Partial<WorkflowPolicyLean>) {
  const approvals: ApprovalLean[] = [];
  let policy: WorkflowPolicyLean | null = initialPolicy
    ? ({
        user: 'u1',
        workflow: 'chase',
        enabled: true,
        autoSend: false,
        ...initialPolicy,
      } as WorkflowPolicyLean)
    : null;
  const notices: string[] = [];
  const reopened: string[] = [];
  const methods: ChaseMethods = {
    getWorkflowPolicy: async () => policy,
    setWorkflowPolicy: async (_user, _workflow, update) => {
      policy = {
        ...(policy ?? { user: 'u1', workflow: 'chase', enabled: true, autoSend: false }),
        ...update,
      } as WorkflowPolicyLean;
      return policy;
    },
    createApproval: async (user: string, data: ApprovalCreateData) => {
      const approval = {
        _id: `a${approvals.length + 1}`,
        user,
        status: 'pending',
        ...data,
        payload: data.payload ?? {},
      } as unknown as ApprovalLean;
      approvals.push(approval);
      return approval;
    },
    decideApproval: async (_user, approvalId, status) => {
      const approval = approvals.find(
        (a) => String(a._id) === approvalId && a.status === 'pending',
      );
      if (!approval) {
        return null;
      }
      approval.status = status;
      return approval;
    },
    reopenApproval: async (_user, approvalId) => {
      reopened.push(approvalId);
      const approval = approvals.find((a) => String(a._id) === approvalId);
      if (approval) {
        approval.status = 'pending';
      }
      return approval ?? null;
    },
    createChannelNotice: async (_user, _kind, text) => {
      notices.push(text);
    },
  };
  return { methods, approvals, notices, reopened, policy: () => policy };
}

function fakeGmail(options: { failSend?: boolean } = {}) {
  const drafts = new Map<string, GmailOutgoing>();
  const sent: string[] = [];
  const deleted: string[] = [];
  return {
    drafts,
    sent,
    deleted,
    api: {
      createDraft: async (draft: GmailOutgoing) => {
        const id = `d${drafts.size + 1}`;
        drafts.set(id, draft);
        return id;
      },
      sendDraft: async (draftId: string) => {
        if (options.failSend) {
          throw new Error('gmail down');
        }
        sent.push(draftId);
        return `m-${draftId}`;
      },
      deleteDraft: async (draftId: string) => {
        deleted.push(draftId);
      },
      getDraftRecipients: async (draftId: string) => ({
        to: [drafts.get(draftId)?.to ?? ''],
        cc: [],
      }),
    },
  };
}

const chatOk = jest.fn(async () =>
  JSON.stringify({
    subject: 'Invoice 1042 — a quick reminder',
    body: 'Hi Dana, invoice 1042 for $12,400 was due August 1. Could you share a payment date? Thank you.',
  }),
);

let vaultPath: string;

beforeEach(async () => {
  vaultPath = await makeVault();
  chatOk.mockClear();
});

afterEach(async () => {
  await fs.rm(vaultPath, { recursive: true, force: true });
});

function deps(overrides: Partial<ChaseDeps> & { methods: ChaseMethods }): ChaseDeps {
  return {
    vaultPath,
    policy: createDraftPolicy({ ownerEmail: OWNER, allowedDomains: ['henderson.example.com'] }),
    audit: NOOP_AUDIT,
    chat: chatOk,
    model: 'test-model',
    ownerName: 'Amir',
    ...overrides,
  };
}

describe('vault fields', () => {
  it('exposes simple frontmatter fields on the index', async () => {
    const index = await loadVault(vaultPath);
    const henderson = index.find((n) => n.id === 'Henderson Invoice 1042');
    expect(henderson?.type).toBe('invoice');
    expect(henderson?.tags).toEqual(['receivable']);
    expect(henderson?.fields).toMatchObject({
      amount: '12400',
      due: '2026-08-01',
      status: 'overdue',
    });
    expect(index.find((n) => n.id === 'Acme')?.fields).toEqual({
      type: 'company',
      tags: '[client]',
    });
  });
});

describe('findOverdueInvoices', () => {
  it('returns unpaid invoices past due with days overdue, excluding open and paid ones', async () => {
    const overdue = await findOverdueInvoices(vaultPath, NOW);
    expect(overdue.map((i) => i.noteId)).toEqual(['Henderson Invoice 1042']);
    expect(overdue[0]).toMatchObject({
      invoiceNumber: '1042',
      company: 'Henderson Logistics',
      contact: 'Dana Lee',
      email: 'dana@henderson.example.com',
      amount: 12400,
      currency: 'USD',
      daysOverdue: 29,
    });
  });
});

describe('composeChase', () => {
  const invoice: OverdueInvoice = {
    noteId: 'Henderson Invoice 1042',
    invoiceNumber: '1042',
    company: 'Henderson Logistics',
    contact: 'Dana Lee',
    email: 'dana@henderson.example.com',
    amount: 12400,
    currency: 'USD',
    due: new Date('2026-08-01T00:00:00Z'),
    daysOverdue: 29,
  };

  it('uses the model draft when it is usable', async () => {
    const draft = await composeChase(chatOk, 'm', invoice, 'Amir');
    expect(draft.subject).toContain('1042');
    expect(chatOk).toHaveBeenCalledWith(expect.any(Array), 'm');
  });

  it('falls back to the template on bad JSON, missing invoice number, or no model', async () => {
    const template = chaseTemplate(invoice, 'Amir');
    expect(template.subject).toBe('Invoice 1042 — $12,400 past due');
    expect(template.body).toContain('August 1, 2026');
    expect(template.body).toContain('29 days past due');
    expect(await composeChase(async () => 'not json', 'm', invoice, 'Amir')).toEqual(template);
    expect(
      await composeChase(
        async () => JSON.stringify({ subject: 'x', body: 'no number' }),
        'm',
        invoice,
        'Amir',
      ),
    ).toEqual(template);
    expect(await composeChase(undefined, 'm', invoice, 'Amir')).toEqual(template);
  });
});

describe('runChase', () => {
  it('records a draft-less approval and a notice when Gmail is not configured', async () => {
    const fake = fakeMethods();
    const result = await runChase(deps({ methods: fake.methods }), 'u1', NOW);
    expect(result).toEqual({
      drafted: ['Henderson Invoice 1042'],
      sent: [],
      blocked: [],
      skipped: [],
    });
    expect(fake.approvals).toHaveLength(1);
    expect(fake.approvals[0]).toMatchObject({
      kind: 'email',
      status: 'pending',
      title: 'Chase: Henderson Logistics invoice 1042 ($12,400)',
    });
    expect(fake.approvals[0].payload.draftId).toBeUndefined();
    expect(fake.approvals[0].payload.to).toBe('dana@henderson.example.com');
    expect(fake.notices).toEqual(['1 chase email drafted — approve in the dashboard.']);
    expect(JSON.parse(fake.policy()?.lastRunSummary ?? '{}').chased).toHaveProperty(
      'Henderson Invoice 1042',
    );
  });

  it('drafts through Gmail for approval and does not send before graduation', async () => {
    const fake = fakeMethods();
    const gmail = fakeGmail();
    const result = await runChase(deps({ methods: fake.methods, api: gmail.api }), 'u1', NOW);
    expect(result.drafted).toEqual(['Henderson Invoice 1042']);
    expect(gmail.drafts.size).toBe(1);
    expect(gmail.sent).toEqual([]);
    expect(fake.approvals[0]).toMatchObject({ status: 'pending', payload: { draftId: 'd1' } });
  });

  it('sends automatically once the workflow is graduated, and reopens on failure', async () => {
    const graduated = { autoSend: true, graduatedAt: new Date('2026-08-20T00:00:00Z') };
    const fake = fakeMethods(graduated);
    const gmail = fakeGmail();
    const result = await runChase(deps({ methods: fake.methods, api: gmail.api }), 'u1', NOW);
    expect(result.sent).toEqual(['Henderson Invoice 1042']);
    expect(gmail.sent).toEqual(['d1']);
    expect(fake.approvals[0].status).toBe('approved');
    expect(fake.notices).toEqual(['1 chase email sent.']);

    const failing = fakeMethods(graduated);
    const down = fakeGmail({ failSend: true });
    const failed = await runChase(deps({ methods: failing.methods, api: down.api }), 'u1', NOW);
    expect(failed.sent).toEqual([]);
    expect(failed.drafted).toEqual(['Henderson Invoice 1042']);
    expect(failing.reopened).toEqual(['a1']);
    expect(failing.approvals[0].status).toBe('pending');
  });

  it('blocks recipients outside the allowlist as denied approvals', async () => {
    const fake = fakeMethods();
    const gmail = fakeGmail();
    const strict = createDraftPolicy({ ownerEmail: OWNER, allowedDomains: [] });
    const result = await runChase(
      deps({ methods: fake.methods, api: gmail.api, policy: strict }),
      'u1',
      NOW,
    );
    expect(result.blocked).toEqual(['Henderson Invoice 1042']);
    expect(gmail.drafts.size).toBe(0);
    expect(fake.approvals[0].status).toBe('denied');
    expect(fake.notices).toEqual(['1 blocked by the draft allowlist.']);
  });

  it('does not re-chase within seven days and skips when the workflow is disabled', async () => {
    const recent = fakeMethods({
      lastRunSummary: JSON.stringify({
        chased: { 'Henderson Invoice 1042': '2026-08-27T00:00:00Z' },
      }),
    });
    const suppressed = await runChase(deps({ methods: recent.methods }), 'u1', NOW);
    expect(suppressed.skipped).toEqual(['Henderson Invoice 1042']);
    expect(recent.approvals).toHaveLength(0);

    const stale = fakeMethods({
      lastRunSummary: JSON.stringify({
        chased: { 'Henderson Invoice 1042': '2026-08-10T00:00:00Z' },
      }),
    });
    const again = await runChase(deps({ methods: stale.methods }), 'u1', NOW);
    expect(again.drafted).toEqual(['Henderson Invoice 1042']);

    const disabled = fakeMethods({ enabled: false });
    const off = await runChase(deps({ methods: disabled.methods }), 'u1', NOW);
    expect(off).toEqual({ drafted: [], sent: [], blocked: [], skipped: [] });
    expect(disabled.approvals).toHaveLength(0);
  });
});
