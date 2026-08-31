import type { RecordAuditEntryInput, GuardrailStateLean } from '@librechat/data-schemas';
import type { BudgetMethods } from './budget';
import {
  checkBudget,
  evaluateBudget,
  getBudgetStatus,
  monthKey,
  monthStart,
  parseBudgetConfig,
  startBudgetMonitor,
} from './budget';

const USER = 'u1';
const NOW = new Date('2026-08-30T12:00:00Z');
const USD = 1_000_000;

function fakeMethods(spendByContext: Record<string, number>) {
  const notices: Array<{ kind: string; text: string }> = [];
  const audits: RecordAuditEntryInput[] = [];
  const pauses: Array<{ paused: boolean; via: string }> = [];
  let state: GuardrailStateLean | null = null;
  let paused = false;
  const methods: BudgetMethods = {
    sumTransactionValueSince: async (_user, since) => ({
      totalCredits: Object.values(spendByContext).reduce((sum, v) => sum + v, 0),
      byContext: spendByContext,
      since,
    }),
    getGuardrailState: async () => state,
    recordBudgetCheck: async (user, month, spendUsd, newMultiples) => {
      const merged = new Set([...(state?.alertedMultiples ?? []), ...newMultiples]);
      state = {
        user,
        month,
        spendUsd,
        alertedMultiples: [...merged].sort((a, b) => a - b),
      } as unknown as GuardrailStateLean;
      return state;
    },
    createChannelNotice: async (_user, kind, text) => {
      notices.push({ kind, text });
      return { kind, text } as never;
    },
    isChannelsPaused: async () => paused,
    setChannelsPaused: async (_user, value, via) => {
      paused = value;
      pauses.push({ paused: value, via });
      return {} as never;
    },
    recordAuditEntry: async (input) => {
      audits.push(input);
      return null;
    },
  };
  return {
    methods,
    notices,
    audits,
    pauses,
    setSpend: (next: Record<string, number>) => Object.assign(spendByContext, next),
  };
}

describe('budget config and arithmetic', () => {
  it('parses env with defaults and sorts/dedupes multiples', () => {
    expect(parseBudgetConfig({})).toEqual({
      expectedUsd: 50,
      multiples: [1, 2, 3],
      hardPause: false,
    });
    expect(
      parseBudgetConfig({
        SILKROAD_MONTHLY_EXPECTED_USD: '120',
        SILKROAD_BUDGET_ALERT_MULTIPLES: '3, 1.5, 1.5, x',
        SILKROAD_BUDGET_HARD_PAUSE: 'ON',
      }),
    ).toEqual({ expectedUsd: 120, multiples: [1.5, 3], hardPause: true });
    expect(parseBudgetConfig({ SILKROAD_MONTHLY_EXPECTED_USD: '0' }).expectedUsd).toBe(0);
  });

  it('keys months in UTC', () => {
    expect(monthKey(new Date('2026-08-31T23:30:00-05:00'))).toBe('2026-09');
    expect(monthStart(NOW).toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });

  it('reports only thresholds not yet alerted, and nothing when disabled', () => {
    expect(
      evaluateBudget({ spendUsd: 131, expectedUsd: 50, multiples: [1, 2, 3], alreadyAlerted: [1] }),
    ).toEqual({ multiple: 2.62, newlyCrossed: [2] });
    expect(
      evaluateBudget({ spendUsd: 131, expectedUsd: 0, multiples: [1, 2, 3], alreadyAlerted: [] }),
    ).toEqual({ multiple: 0, newlyCrossed: [] });
  });
});

describe('checkBudget', () => {
  const config = { expectedUsd: 50, multiples: [1, 2, 3], hardPause: false };

  it('fires one notice and one audit per newly crossed threshold, then never again that month', async () => {
    const fake = fakeMethods({ message: 100 * USD, channel: 31 * USD });
    const status = await checkBudget({ methods: fake.methods, config }, USER, NOW);
    expect(status).toMatchObject({
      month: '2026-08',
      spendUsd: 131,
      expectedUsd: 50,
      alerted: [1, 2],
      byContextUsd: { message: 100, channel: 31 },
      paused: false,
      pausedVia: null,
    });
    expect(status.multiple).toBeCloseTo(2.62);
    expect(fake.notices).toHaveLength(2);
    expect(fake.notices[0].text).toBe(
      'Silkroad spend this month is $131 — 2.6× the expected $50.00.',
    );
    expect(fake.audits.map((a) => a.action)).toEqual([
      'guardrail.budget_alert',
      'guardrail.budget_alert',
    ]);
    expect(fake.audits[0]).toMatchObject({
      actor: { type: 'system', name: 'silkroad-guardrails' },
      target: { type: 'budget', id: '2026-08' },
      metadata: { user: USER, spendUsd: 131, expectedUsd: 50, threshold: 1 },
    });

    const again = await checkBudget({ methods: fake.methods, config }, USER, NOW);
    expect(again.alerted).toEqual([1, 2]);
    expect(fake.notices).toHaveLength(2);
    expect(fake.audits).toHaveLength(2);
    expect(fake.pauses).toEqual([]);
  });

  it('hard-pauses on the top threshold only when opted in', async () => {
    const fake = fakeMethods({ message: 160 * USD });
    const status = await checkBudget(
      { methods: fake.methods, config: { ...config, hardPause: true } },
      USER,
      NOW,
    );
    expect(fake.pauses).toEqual([{ paused: true, via: 'budget' }]);
    expect(fake.notices.map((n) => n.text.slice(0, 22))).toEqual([
      'Silkroad spend this mo',
      'Silkroad spend this mo',
      'Silkroad spend this mo',
      'Silkroad paused itself',
    ]);
    expect(fake.audits.map((a) => a.action)).toContain('guardrail.budget_pause');
    expect(status).toMatchObject({ paused: true, pausedVia: 'budget', alerted: [1, 2, 3] });
  });

  it('exposes a read-only status without writing anything', async () => {
    const fake = fakeMethods({ message: 20 * USD });
    const status = await getBudgetStatus({ methods: fake.methods, config }, USER, NOW);
    expect(status).toMatchObject({ spendUsd: 20, multiple: 0.4, alerted: [], paused: false });
    expect(fake.notices).toHaveLength(0);
    expect(fake.audits).toHaveLength(0);
  });

  it('runs as a monitor loop with an immediate first tick', async () => {
    jest.useFakeTimers();
    const fake = fakeMethods({ message: 55 * USD });
    const logger = { info: jest.fn(), error: jest.fn() };
    const handle = startBudgetMonitor({
      methods: fake.methods,
      config,
      user: USER,
      intervalMs: 60_000,
      logger,
      now: () => NOW,
    });
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(0);
    expect(fake.notices).toHaveLength(1);
    fake.setSpend({ message: 105 * USD });
    await jest.advanceTimersByTimeAsync(60_000);
    expect(fake.notices).toHaveLength(2);
    handle.stop();
    jest.useRealTimers();
    expect(logger.error).not.toHaveBeenCalled();
  });
});
