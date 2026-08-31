import type {
  RecordAuditEntryInput,
  TransactionSpendSummary,
  GuardrailStateLean,
  ChannelNoticeLean,
  ChannelStateLean,
} from '@librechat/data-schemas';

export interface BudgetConfig {
  /** Expected monthly spend in USD; 0 disables the guardrail. */
  expectedUsd: number;
  /** Multiples of `expectedUsd` that trigger an alert, ascending. */
  multiples: number[];
  /** Pause every channel when the highest multiple is crossed (brief §6 asks for an alert; pausing is opt-in). */
  hardPause: boolean;
}

export interface BudgetEvaluation {
  multiple: number;
  newlyCrossed: number[];
}

export interface BudgetStatus {
  month: string;
  spendUsd: number;
  expectedUsd: number;
  multiple: number;
  alerted: number[];
  byContextUsd: Record<string, number>;
  paused: boolean;
  pausedVia: 'budget' | 'other' | null;
}

export interface BudgetMethods {
  sumTransactionValueSince: (user: string, since: Date) => Promise<TransactionSpendSummary>;
  getGuardrailState: (user: string, month: string) => Promise<GuardrailStateLean | null>;
  recordBudgetCheck: (
    user: string,
    month: string,
    spendUsd: number,
    newMultiples: number[],
  ) => Promise<GuardrailStateLean>;
  createChannelNotice: (user: string, kind: string, text: string) => Promise<ChannelNoticeLean>;
  isChannelsPaused: (user: string) => Promise<boolean>;
  setChannelsPaused: (user: string, paused: boolean, via: string) => Promise<ChannelStateLean>;
  recordAuditEntry: (input: RecordAuditEntryInput) => Promise<unknown>;
}

export type BudgetStatusMethods = Pick<
  BudgetMethods,
  'sumTransactionValueSince' | 'getGuardrailState' | 'isChannelsPaused'
>;

export interface BudgetDeps {
  methods: BudgetMethods;
  config: BudgetConfig;
}

export interface BudgetLogger {
  info: (message: string) => void;
  error: (message: string, error?: unknown) => void;
}

const DEFAULT_EXPECTED_USD = 50;
const DEFAULT_MULTIPLES = [1, 2, 3];
const CREDITS_PER_USD = 1_000_000;
const NOTICE_KIND = 'budget';
const AUDIT_ACTOR = { type: 'system', name: 'silkroad-guardrails' } as const;

function parseMultiples(raw: string | undefined): number[] {
  const parsed = (raw ?? '')
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isFinite(value) && value > 0);
  const unique = [...new Set(parsed)].sort((a, b) => a - b);
  return unique.length > 0 ? unique : DEFAULT_MULTIPLES;
}

export function parseBudgetConfig(env: NodeJS.ProcessEnv): BudgetConfig {
  const expected = Number(env.SILKROAD_MONTHLY_EXPECTED_USD);
  return {
    expectedUsd: Number.isFinite(expected) && expected >= 0 ? expected : DEFAULT_EXPECTED_USD,
    multiples: parseMultiples(env.SILKROAD_BUDGET_ALERT_MULTIPLES),
    hardPause: (env.SILKROAD_BUDGET_HARD_PAUSE ?? 'off').toLowerCase() === 'on',
  };
}

/** `yyyy-mm` in UTC — the key every per-month record uses. */
export function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function monthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

export function evaluateBudget(input: {
  spendUsd: number;
  expectedUsd: number;
  multiples: number[];
  alreadyAlerted: number[];
}): BudgetEvaluation {
  if (input.expectedUsd <= 0) {
    return { multiple: 0, newlyCrossed: [] };
  }
  const multiple = input.spendUsd / input.expectedUsd;
  const alerted = new Set(input.alreadyAlerted);
  const newlyCrossed = input.multiples.filter(
    (threshold) => multiple >= threshold && !alerted.has(threshold),
  );
  return { multiple, newlyCrossed };
}

function creditsToUsd(credits: number): number {
  return credits / CREDITS_PER_USD;
}

function formatUsd(value: number): string {
  return `$${value.toFixed(value >= 100 ? 0 : 2)}`;
}

function alertText(spendUsd: number, expectedUsd: number, multiple: number): string {
  return `Silkroad spend this month is ${formatUsd(spendUsd)} — ${multiple.toFixed(1)}× the expected ${formatUsd(expectedUsd)}.`;
}

function pauseText(spendUsd: number, expectedUsd: number): string {
  return `Silkroad paused itself: spend reached ${formatUsd(spendUsd)} against an expected ${formatUsd(expectedUsd)}. Reply "resume" to continue.`;
}

function byContextUsd(summary: TransactionSpendSummary): Record<string, number> {
  return Object.fromEntries(
    Object.entries(summary.byContext).map(([context, credits]) => [context, creditsToUsd(credits)]),
  );
}

function auditEntry(
  action: 'guardrail.budget_alert' | 'guardrail.budget_pause',
  user: string,
  month: string,
  detail: { spendUsd: number; expectedUsd: number; multiple: number; threshold: number },
): RecordAuditEntryInput {
  return {
    action,
    actor: AUDIT_ACTOR,
    target: { type: 'budget', id: month, name: `budget:${month}` },
    severity: action === 'guardrail.budget_pause' ? 'critical' : 'warning',
    metadata: {
      user,
      spendUsd: Number(detail.spendUsd.toFixed(2)),
      expectedUsd: detail.expectedUsd,
      multiple: Number(detail.multiple.toFixed(2)),
      threshold: detail.threshold,
    },
  };
}

async function pausedVia(
  methods: Pick<BudgetMethods, 'isChannelsPaused'>,
  user: string,
  state: GuardrailStateLean | null,
  config: BudgetConfig,
): Promise<Pick<BudgetStatus, 'paused' | 'pausedVia'>> {
  const paused = await methods.isChannelsPaused(user);
  if (!paused) {
    return { paused: false, pausedVia: null };
  }
  const top = config.multiples[config.multiples.length - 1];
  const byBudget = config.hardPause && (state?.alertedMultiples ?? []).includes(top);
  return { paused: true, pausedVia: byBudget ? 'budget' : 'other' };
}

/** Read-only view for the dashboard: month-to-date spend against the expected budget. */
export async function getBudgetStatus(
  deps: { methods: BudgetStatusMethods; config: BudgetConfig },
  user: string,
  now: Date = new Date(),
): Promise<BudgetStatus> {
  const month = monthKey(now);
  const [summary, state] = await Promise.all([
    deps.methods.sumTransactionValueSince(user, monthStart(now)),
    deps.methods.getGuardrailState(user, month),
  ]);
  const spendUsd = creditsToUsd(summary.totalCredits);
  const { multiple } = evaluateBudget({
    spendUsd,
    expectedUsd: deps.config.expectedUsd,
    multiples: deps.config.multiples,
    alreadyAlerted: [],
  });
  return {
    month,
    spendUsd,
    expectedUsd: deps.config.expectedUsd,
    multiple,
    alerted: state?.alertedMultiples ?? [],
    byContextUsd: byContextUsd(summary),
    ...(await pausedVia(deps.methods, user, state, deps.config)),
  };
}

/**
 * One budget check: sums the month's spend, fires a notice + audit entry for
 * every threshold crossed since the last check, optionally hard-pauses on the
 * top threshold, and records the check so each threshold fires once per month.
 */
export async function checkBudget(
  deps: BudgetDeps,
  user: string,
  now: Date = new Date(),
): Promise<BudgetStatus> {
  const { methods, config } = deps;
  const month = monthKey(now);
  const [summary, state] = await Promise.all([
    methods.sumTransactionValueSince(user, monthStart(now)),
    methods.getGuardrailState(user, month),
  ]);
  const spendUsd = creditsToUsd(summary.totalCredits);
  const { multiple, newlyCrossed } = evaluateBudget({
    spendUsd,
    expectedUsd: config.expectedUsd,
    multiples: config.multiples,
    alreadyAlerted: state?.alertedMultiples ?? [],
  });

  for (const threshold of newlyCrossed) {
    await methods.createChannelNotice(
      user,
      NOTICE_KIND,
      alertText(spendUsd, config.expectedUsd, multiple),
    );
    await methods.recordAuditEntry(
      auditEntry('guardrail.budget_alert', user, month, {
        spendUsd,
        expectedUsd: config.expectedUsd,
        multiple,
        threshold,
      }),
    );
  }

  const top = config.multiples[config.multiples.length - 1];
  if (config.hardPause && newlyCrossed.includes(top)) {
    await methods.setChannelsPaused(user, true, 'budget');
    await methods.createChannelNotice(user, NOTICE_KIND, pauseText(spendUsd, config.expectedUsd));
    await methods.recordAuditEntry(
      auditEntry('guardrail.budget_pause', user, month, {
        spendUsd,
        expectedUsd: config.expectedUsd,
        multiple,
        threshold: top,
      }),
    );
  }

  const recorded = await methods.recordBudgetCheck(user, month, spendUsd, newlyCrossed);
  return {
    month,
    spendUsd,
    expectedUsd: config.expectedUsd,
    multiple,
    alerted: recorded.alertedMultiples,
    byContextUsd: byContextUsd(summary),
    ...(await pausedVia(methods, user, recorded, config)),
  };
}

export interface BudgetMonitorHandle {
  stop: () => void;
}

/** Hourly-class loop in the worker process; same shape as `startBrainWorker`. */
export function startBudgetMonitor(
  deps: BudgetDeps & { user: string; intervalMs: number; logger: BudgetLogger; now?: () => Date },
): BudgetMonitorHandle {
  let running = false;
  const tick = async () => {
    if (running) {
      return;
    }
    running = true;
    try {
      const status = await checkBudget(deps, deps.user, deps.now?.() ?? new Date());
      deps.logger.info(
        `guardrails: budget ${status.month} ${formatUsd(status.spendUsd)} / ${formatUsd(status.expectedUsd)} (${status.multiple.toFixed(2)}×)`,
      );
    } catch (error) {
      deps.logger.error('guardrails: budget check failed', error);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, deps.intervalMs);
  void tick();
  return { stop: () => clearInterval(timer) };
}
