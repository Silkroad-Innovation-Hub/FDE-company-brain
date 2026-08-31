import { useState } from 'react';
import { Brain, ShieldAlert, CheckCircle2, MessageSquareText } from 'lucide-react';
import { Button } from '@librechat/client';
import type {
  TGuardrailsActivityEntry,
  TGuardrailsActivityCategory,
  TGuardrailsActivityOutcome,
} from 'librechat-data-provider';
import type { LucideIcon } from 'lucide-react';
import { useGuardrailsActivityQuery } from '~/data-provider';
import { cn, getMessageTimestamp } from '~/utils';
import { useLocalize } from '~/hooks';

type LocalizeFn = ReturnType<typeof useLocalize>;
type LocalizeKey = Parameters<LocalizeFn>[0];

const INITIAL_LIMIT = 20;
const EXPANDED_LIMIT = 50;

const categoryIcons: Record<TGuardrailsActivityCategory, LucideIcon> = {
  approval: CheckCircle2,
  channel: MessageSquareText,
  guardrail: ShieldAlert,
  brain: Brain,
};

const outcomeLabels: Record<Exclude<TGuardrailsActivityOutcome, 'success'>, LocalizeKey> = {
  failure: 'com_ui_outcome_failure',
  denied: 'com_ui_outcome_denied',
  pending: 'com_ui_outcome_pending',
};

const surfaceLabels: Record<string, string> = { imessage: 'iMessage', email: 'Email' };

const approvalKindLabels: Record<string, LocalizeKey> = {
  email: 'com_ui_action_email',
  message: 'com_ui_action_message',
  document: 'com_ui_action_document',
};

function metaString(entry: TGuardrailsActivityEntry, key: string): string {
  const value = entry.metadata?.[key];
  return value == null ? '' : String(value);
}

function surfaceOf(entry: TGuardrailsActivityEntry): string {
  const raw = metaString(entry, 'surface') || metaString(entry, 'via') || entry.target.type;
  return surfaceLabels[raw] ?? raw;
}

function approvalKind(entry: TGuardrailsActivityEntry, localize: LocalizeFn): string {
  const key = approvalKindLabels[metaString(entry, 'kind')];
  return key ? localize(key).toLowerCase() : localize('com_ui_action_generic');
}

/** One human sentence per audit action; unknown actions fall back to the raw action name. */
export function describeEntry(entry: TGuardrailsActivityEntry, localize: LocalizeFn): string {
  const domain = metaString(entry, 'recipientDomain') || metaString(entry, 'blockedDomains');
  const noteName = entry.target.name ?? entry.target.id ?? '';
  const multiple = metaString(entry, 'multiple');
  switch (entry.action) {
    case 'channel.reply_sent':
      return localize('com_ui_act_reply_sent', { 0: surfaceOf(entry) });
    case 'channel.paused':
      return localize('com_ui_act_paused', { 0: surfaceOf(entry) });
    case 'channel.resumed':
      return localize('com_ui_act_resumed', { 0: surfaceOf(entry) });
    case 'channel.draft_created':
      return localize('com_ui_act_draft_created', { 0: domain });
    case 'channel.draft_sent':
      return localize('com_ui_act_draft_sent', { 0: domain });
    case 'channel.draft_deleted':
      return localize('com_ui_act_draft_deleted');
    case 'channel.draft_blocked':
      return localize('com_ui_act_draft_blocked', { 0: domain });
    case 'approval.created':
      return localize('com_ui_act_approval_created', { 0: approvalKind(entry, localize) });
    case 'approval.approved':
      return localize('com_ui_act_approval_approved', { 0: approvalKind(entry, localize) });
    case 'approval.denied':
      return localize('com_ui_act_approval_denied', { 0: approvalKind(entry, localize) });
    case 'approval.reopened':
      return localize('com_ui_act_approval_reopened');
    case 'brain.write_applied':
      return localize('com_ui_act_brain_applied', { 0: noteName });
    case 'brain.write_rejected':
      return localize('com_ui_act_brain_rejected', { 0: noteName });
    case 'guardrail.budget_alert':
      return localize('com_ui_act_budget_alert', { 0: multiple });
    case 'guardrail.budget_pause':
      return localize('com_ui_act_budget_pause', { 0: multiple });
    default:
      return entry.action;
  }
}

function OutcomeChip({ outcome }: { outcome: TGuardrailsActivityOutcome }) {
  const localize = useLocalize();
  if (outcome === 'success') {
    return null;
  }
  return (
    <span className="shrink-0 rounded-full border border-border-medium px-2 py-0.5 text-xs font-medium text-text-secondary">
      {localize(outcomeLabels[outcome])}
    </span>
  );
}

function Row({ entry }: { entry: TGuardrailsActivityEntry }) {
  const localize = useLocalize();
  const Icon = categoryIcons[entry.category] ?? ShieldAlert;
  const timestamp = getMessageTimestamp(entry.timestamp);
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-secondary">
        <Icon className="h-4 w-4 text-text-secondary" aria-hidden="true" />
      </span>
      <p className="min-w-0 flex-1 truncate text-sm text-text-primary">
        {describeEntry(entry, localize)}
      </p>
      <OutcomeChip outcome={entry.outcome} />
      {timestamp != null && (
        <time
          dateTime={timestamp.iso}
          title={timestamp.absolute}
          className="hidden w-20 shrink-0 text-right text-xs text-text-tertiary sm:block"
        >
          {timestamp.relative}
        </time>
      )}
    </li>
  );
}

export default function Activity() {
  const localize = useLocalize();
  const [limit, setLimit] = useState(INITIAL_LIMIT);
  const { data, isLoading, isError } = useGuardrailsActivityQuery(limit);
  const entries = data?.entries ?? [];
  const canExpand = limit === INITIAL_LIMIT && entries.length >= INITIAL_LIMIT;

  return (
    <section
      aria-label={localize('com_ui_activity')}
      className="flex flex-col gap-3 rounded-2xl border border-border-light bg-surface-primary p-5 shadow-sm"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-text-primary">{localize('com_ui_activity')}</h2>
        <span className="text-xs text-text-tertiary">{localize('com_ui_activity_hint')}</span>
      </div>
      {isLoading && (
        <div className="flex flex-col gap-2" aria-busy="true">
          {[0, 1, 2].map((row) => (
            <div key={row} className="h-10 animate-pulse rounded-lg bg-surface-secondary" />
          ))}
        </div>
      )}
      {!isLoading && isError && (
        <p className="py-2 text-sm text-text-tertiary">{localize('com_ui_activity_error')}</p>
      )}
      {!isLoading && !isError && entries.length === 0 && (
        <p className="py-2 text-sm text-text-tertiary">{localize('com_ui_activity_empty')}</p>
      )}
      {!isLoading && entries.length > 0 && (
        <ul className={cn('flex flex-col divide-y divide-border-light')}>
          {entries.map((entry) => (
            <Row key={entry.id} entry={entry} />
          ))}
        </ul>
      )}
      {canExpand && (
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => setLimit(EXPANDED_LIMIT)}
        >
          {localize('com_ui_show_more')}
        </Button>
      )}
    </section>
  );
}
