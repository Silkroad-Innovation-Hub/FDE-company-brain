import type {
  TodoLean,
  ApprovalLean,
  BrainLogLean,
  ChannelNoticeLean,
  WorkflowPolicyLean,
  GuardrailStateLean,
} from '@librechat/data-schemas';
import type { BrainChatMessage } from '~/brain/openai';
import type { BriefDeps } from './brief';
import { gatherBrief, renderBrief, composeBrief, runBrief } from './brief';

const NOW = new Date('2026-06-10T11:00:00Z');
const logger = { info: jest.fn(), error: jest.fn() };

function fakeMethods(overrides: Partial<BriefDeps['methods']> = {}) {
  const notices: Array<{ kind: string; text: string }> = [];
  const policies = new Map<string, WorkflowPolicyLean>();
  const methods: BriefDeps['methods'] = {
    getTodos: async () =>
      [
        { text: 'Chase Henderson', done: false, position: 2, dueDate: new Date('2026-06-12') },
        { text: 'Old', done: true, position: 0 },
        { text: 'Sign lease', done: false, position: 1 },
      ] as unknown as TodoLean[],
    getApprovals: async () =>
      [
        { title: 'Invoice 1042 chase', status: 'pending' },
        { title: 'Old draft', status: 'approved' },
      ] as unknown as ApprovalLean[],
    listBrainLogs: async ({ status }) => {
      if (status === 'applied') {
        return [
          { noteId: 'Henderson Invoice', processedAt: new Date('2026-06-10T09:00:00Z') },
          { noteId: 'Henderson Invoice', processedAt: new Date('2026-06-10T08:00:00Z') },
          { noteId: 'Ancient', processedAt: new Date('2026-06-01T08:00:00Z') },
        ] as unknown as BrainLogLean[];
      }
      return [{ noteId: 'Dana Lee' }] as unknown as BrainLogLean[];
    },
    getWorkflowPolicy: async (_user, workflow) => policies.get(workflow) ?? null,
    setWorkflowPolicy: async (user, workflow, update) => {
      const policy = {
        user,
        workflow,
        enabled: true,
        autoSend: false,
        ...update,
      } as unknown as WorkflowPolicyLean;
      policies.set(workflow, policy);
      return policy;
    },
    createChannelNotice: async (_user, kind, text) => {
      notices.push({ kind, text });
      return { kind, text } as unknown as ChannelNoticeLean;
    },
    sumTransactionValueSince: async () => ({ totalCredits: 12_500_000, byContext: {}, since: NOW }),
    getGuardrailState: async () => null as GuardrailStateLean | null,
    isChannelsPaused: async () => false,
    ...overrides,
  };
  return { methods, notices, policies };
}

function deps(methods: BriefDeps['methods'], extra: Partial<BriefDeps> = {}): BriefDeps {
  return {
    methods,
    budget: { expectedUsd: 50, multiples: [1, 2, 3], hardPause: false },
    timeZone: 'America/New_York',
    logger,
    ...extra,
  };
}

describe('gatherBrief / renderBrief', () => {
  it('collects every section, sorted and filtered, and renders them in order', async () => {
    const { methods } = fakeMethods();
    const sections = await gatherBrief(
      deps(methods, {
        calendar: {
          listToday: async () => [
            { start: '09:30', end: '10:00', title: 'Board prep', location: 'Room 4', attendees: 2 },
          ],
        },
      }),
      'u1',
      NOW,
    );
    expect(sections.today).toEqual(['09:30–10:00 Board prep @ Room 4 (2 others)']);
    expect(sections.todos).toEqual(['Chase Henderson (due Jun 12)', 'Sign lease']);
    expect(sections.approvals).toEqual(['1 pending: Invoice 1042 chase']);
    expect(sections.brain).toEqual([
      '1 note updated: Henderson Invoice',
      '1 memory write awaiting your approval',
    ]);
    expect(sections.spend).toEqual(['$12.50 of $50 this month (0.3×)']);

    const text = renderBrief(sections);
    const order = ['Today', 'Owed to you / by you', 'Waiting on you', 'Brain', 'Spend'].map((t) =>
      text.indexOf(t),
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((i) => i >= 0)).toBe(true);
  });

  it('omits empty sections and never goes silent', async () => {
    const { methods } = fakeMethods({
      getTodos: async () => [],
      getApprovals: async () => [],
      listBrainLogs: async () => [],
    });
    const sections = await gatherBrief(
      deps(methods, { budget: { expectedUsd: 0, multiples: [], hardPause: false } }),
      'u1',
      NOW,
    );
    expect(renderBrief(sections)).toBe(
      'Nothing on the calendar, no open to-dos, nothing waiting on you.',
    );
  });

  it('degrades a failing source to empty instead of failing the brief', async () => {
    const { methods } = fakeMethods({
      getTodos: async () => {
        throw new Error('db down');
      },
    });
    const sections = await gatherBrief(deps(methods), 'u1', NOW);
    expect(sections.todos).toEqual([]);
    expect(sections.approvals).toHaveLength(1);
  });
});

describe('composeBrief', () => {
  it('polishes through one model call fed with the rendered sections', async () => {
    const { methods } = fakeMethods();
    const chat = jest.fn(async (messages: BrainChatMessage[]) => {
      expect(messages[1].content).toContain('Owed to you / by you');
      expect(messages[1].content).toContain('Chase Henderson');
      return '  Owed to you / by you\n- Chase Henderson (due Jun 12)  ';
    });
    const text = await composeBrief(deps(methods, { chat, model: 'test-model' }), 'u1', NOW);
    expect(text).toBe('Owed to you / by you\n- Chase Henderson (due Jun 12)');
    expect(chat).toHaveBeenCalledWith(expect.any(Array), 'test-model');
  });

  it('falls back to the plain rendering when the model fails', async () => {
    const { methods } = fakeMethods();
    const chat = jest.fn(async () => {
      throw new Error('timeout');
    });
    const text = await composeBrief(deps(methods, { chat }), 'u1', NOW);
    expect(text).toContain('Owed to you / by you\n- Chase Henderson (due Jun 12)');
    expect(text).toContain('Spend');
  });
});

describe('runBrief', () => {
  it('creates an owner notice and stamps the policy', async () => {
    const { methods, notices, policies } = fakeMethods();
    const result = await runBrief(deps(methods), 'u1', NOW);
    expect(result.skipped).toBe(false);
    expect(notices).toHaveLength(1);
    expect(notices[0].kind).toBe('brief');
    expect(notices[0].text).toBe(result.text);
    expect(policies.get('brief')).toMatchObject({ lastRunAt: NOW, lastRunSummary: result.text });
  });

  it('skips when the owner disabled the workflow', async () => {
    const { methods, notices } = fakeMethods({
      getWorkflowPolicy: async () => ({ enabled: false }) as unknown as WorkflowPolicyLean,
    });
    expect(await runBrief(deps(methods), 'u1', NOW)).toEqual({ skipped: true });
    expect(notices).toHaveLength(0);
  });
});
