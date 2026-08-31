import type { TWorkflowProcessHealth } from 'librechat-data-provider';
import { useWorkflowsHealthQuery } from '~/data-provider';
import { getMessageTimestamp } from '~/utils';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

type LocalizeFn = ReturnType<typeof useLocalize>;
type LocalizeKey = Parameters<LocalizeFn>[0];

type HealthState = 'alive' | 'stale' | 'never';

const processLabels: Record<TWorkflowProcessHealth['name'], LocalizeKey> = {
  worker: 'com_ui_health_worker',
  imessage: 'com_ui_health_imessage',
  gmail: 'com_ui_health_gmail',
};

const stateLabels: Record<HealthState, LocalizeKey> = {
  alive: 'com_ui_health_alive',
  stale: 'com_ui_health_stale',
  never: 'com_ui_health_never',
};

function stateOf(process: TWorkflowProcessHealth): HealthState {
  if (process.alive) {
    return 'alive';
  }
  return process.lastSeenAt ? 'stale' : 'never';
}

function Dot({ process }: { process: TWorkflowProcessHealth }) {
  const localize = useLocalize();
  const state = stateOf(process);
  const seen = process.lastSeenAt ? getMessageTimestamp(process.lastSeenAt) : null;
  const label = localize(processLabels[process.name]);
  const status = localize(stateLabels[state]);
  const title = seen ? `${label} · ${status} · ${seen.relative}` : `${label} · ${status}`;
  return (
    <span className="flex items-center gap-1.5" title={title} aria-label={title}>
      <span
        aria-hidden="true"
        className={cn(
          'h-2 w-2 rounded-full',
          state === 'alive' && 'bg-text-primary',
          state === 'stale' && 'bg-text-tertiary',
          state === 'never' && 'border border-border-heavy',
        )}
      />
      <span className="text-xs text-text-tertiary">{label}</span>
    </span>
  );
}

/** One-line liveness strip for the long-running Silkroad processes. */
export default function Health() {
  const localize = useLocalize();
  const { data } = useWorkflowsHealthQuery();
  if (data == null) {
    return null;
  }
  return (
    <div role="status" aria-label={localize('com_ui_health')} className="flex items-center gap-4">
      {data.processes.map((process) => (
        <Dot key={process.name} process={process} />
      ))}
    </div>
  );
}
