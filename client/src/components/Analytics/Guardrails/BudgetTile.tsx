import { useGuardrailsStatusQuery } from '~/data-provider';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

type BudgetState = 'normal' | 'alerted' | 'paused';

const METER_FLOOR_MULTIPLE = 3;

const stateLabels = {
  normal: 'com_ui_budget_normal',
  alerted: 'com_ui_budget_alerted',
  paused: 'com_ui_budget_paused',
} as const;

function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value < 100 ? 2 : 0,
  }).format(value);
}

function budgetState(paused: boolean, alertedCount: number): BudgetState {
  if (paused) {
    return 'paused';
  }
  return alertedCount > 0 ? 'alerted' : 'normal';
}

function StateChip({ state }: { state: BudgetState }) {
  const localize = useLocalize();
  return (
    <span
      className={cn(
        'shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium',
        state === 'normal' && 'border-border-medium text-text-tertiary',
        state === 'alerted' && 'border-border-heavy text-text-secondary',
        state === 'paused' && 'border-border-heavy bg-surface-secondary text-text-primary',
      )}
    >
      {localize(stateLabels[state])}
    </span>
  );
}

export default function BudgetTile() {
  const localize = useLocalize();
  const { data, isLoading, isError } = useGuardrailsStatusQuery();

  const label = localize('com_ui_token_spend_month');
  const frame =
    'flex flex-col gap-1 rounded-2xl border border-border-light bg-surface-primary p-4 shadow-sm';

  if (isLoading) {
    return (
      <div className={frame} aria-busy="true" aria-label={label}>
        <span className="text-xs uppercase tracking-wide text-text-tertiary">{label}</span>
        <div className="h-7 w-24 animate-pulse rounded-md bg-surface-secondary" />
        <div className="h-3 w-32 animate-pulse rounded-md bg-surface-secondary" />
      </div>
    );
  }

  if (isError || data == null) {
    return (
      <div className={frame} aria-label={label}>
        <span className="text-xs uppercase tracking-wide text-text-tertiary">{label}</span>
        <span className="text-xl font-semibold text-text-tertiary xl:text-2xl">—</span>
        <span className="text-xs text-text-tertiary">{localize('com_ui_budget_error')}</span>
      </div>
    );
  }

  const state = budgetState(data.paused, data.alerted.length);
  const cap = Math.max(METER_FLOOR_MULTIPLE, ...data.alerted);
  const fill = Math.min(100, Math.round((data.multiple / cap) * 100));

  return (
    <div className={frame} aria-label={label}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs uppercase tracking-wide text-text-tertiary">{label}</span>
        <StateChip state={state} />
      </div>
      <span className="text-xl font-semibold text-text-primary xl:text-2xl">
        {formatUsd(data.spendUsd)}
      </span>
      <span className="text-xs text-text-tertiary">
        {localize('com_ui_budget_of_expected', {
          0: formatUsd(data.expectedUsd),
          1: data.multiple.toFixed(1),
        })}
      </span>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={cap}
        aria-valuenow={Math.min(cap, data.multiple)}
        className="mt-1 h-1 w-full overflow-hidden rounded-full bg-surface-secondary"
      >
        <div
          className={cn(
            'h-full rounded-full transition-all',
            state === 'normal' ? 'bg-text-tertiary' : 'bg-text-primary',
          )}
          style={{ width: `${fill}%` }}
        />
      </div>
    </div>
  );
}
