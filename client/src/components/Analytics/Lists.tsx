import {
  Sun,
  Send,
  Inbox,
  Landmark,
  PenLine,
  Database,
  CheckCircle2,
  AlertTriangle,
  CalendarDays,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { FeedItem } from './sample';
import {
  sampleFeed,
  samplePayables,
  formatCurrency,
  sampleSchedule,
  sampleBrainIndex,
  sampleBankAccounts,
  sampleOverdueInvoices,
} from './sample';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';
import Panel from './Panel';

export function OverdueInvoices() {
  const localize = useLocalize();
  return (
    <Panel title={localize('com_ui_top_overdue')} isSample>
      <ul className="flex flex-col divide-y divide-border-light">
        {sampleOverdueInvoices.map((invoice) => (
          <li key={invoice.client} className="flex items-center justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm text-text-primary">{invoice.client}</p>
              <p
                className={cn(
                  'text-xs',
                  invoice.daysOverdue >= 60 ? 'text-destructive' : 'text-text-tertiary',
                )}
              >
                {localize('com_ui_days_overdue', { 0: String(invoice.daysOverdue) })}
              </p>
            </div>
            <span className="shrink-0 text-sm font-medium text-text-primary">
              {formatCurrency(invoice.amount)}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function Payables() {
  const localize = useLocalize();
  return (
    <Panel title={localize('com_ui_upcoming_payables')} isSample>
      <ul className="flex flex-col divide-y divide-border-light">
        {samplePayables.map((payable) => (
          <li key={payable.vendor} className="flex items-center justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm text-text-primary">{payable.vendor}</p>
              <p className="text-xs text-text-tertiary">{payable.dueIn}</p>
            </div>
            <span className="shrink-0 text-sm font-medium text-text-primary">
              {formatCurrency(payable.amount)}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function BankAccounts() {
  const localize = useLocalize();
  return (
    <Panel title={localize('com_ui_bank_accounts')} isSample>
      <ul className="flex flex-col divide-y divide-border-light">
        {sampleBankAccounts.map((account) => (
          <li key={account.name} className="flex items-center justify-between gap-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <Landmark className="h-4 w-4 shrink-0 text-text-tertiary" aria-hidden="true" />
              <div className="min-w-0">
                <p className="truncate text-sm text-text-primary">{account.name}</p>
                <p className="text-xs text-text-tertiary">{account.kind}</p>
              </div>
            </div>
            <span
              className={cn(
                'shrink-0 text-sm font-medium',
                account.balance < 0 ? 'text-destructive' : 'text-text-primary',
              )}
            >
              {formatCurrency(account.balance)}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function Schedule() {
  const localize = useLocalize();
  return (
    <Panel title={localize('com_ui_today_schedule')} isSample>
      <ul className="flex flex-col divide-y divide-border-light">
        {sampleSchedule.map((item) => (
          <li key={item.time} className="flex items-center gap-3 py-2.5">
            <span className="w-12 shrink-0 text-sm font-medium tabular-nums text-text-secondary">
              {item.time}
            </span>
            <CalendarDays className="h-4 w-4 shrink-0 text-text-tertiary" aria-hidden="true" />
            <div className="min-w-0">
              <p className="truncate text-sm text-text-primary">{item.title}</p>
              <p className="truncate text-xs text-text-tertiary">{item.attendees}</p>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

const feedIcons: Record<FeedItem['type'], LucideIcon> = {
  sent: Send,
  drafted: PenLine,
  task: CheckCircle2,
  indexed: Database,
  brief: Sun,
  chased: AlertTriangle,
};

export function ActivityFeed() {
  const localize = useLocalize();
  return (
    <Panel title={localize('com_ui_recent_activity')} isSample>
      <ul className="flex flex-col divide-y divide-border-light">
        {sampleFeed.map((item) => {
          const Icon = feedIcons[item.type];
          return (
            <li key={item.text} className="flex items-start gap-3 py-2.5">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-secondary">
                <Icon className="h-3.5 w-3.5 text-text-secondary" aria-hidden="true" />
              </span>
              <p className="min-w-0 flex-1 text-sm text-text-primary">{item.text}</p>
              <span className="shrink-0 text-xs text-text-tertiary">{item.time}</span>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

const brainLabelKeys: Record<string, string> = {
  emails: 'com_ui_brain_emails',
  documents: 'com_ui_brain_documents',
  invoices: 'com_ui_brain_invoices',
  contacts: 'com_ui_brain_contacts',
};

export function BrainIndex() {
  const localize = useLocalize();
  return (
    <Panel title={localize('com_ui_company_brain')} isSample>
      <div className="grid grid-cols-2 gap-3">
        {sampleBrainIndex.map((entry) => (
          <div
            key={entry.key}
            className="flex flex-col gap-0.5 rounded-xl bg-surface-secondary p-3"
          >
            <span className="text-lg font-semibold tabular-nums text-text-primary">
              {entry.count.toLocaleString('en-US')}
            </span>
            <span className="flex items-center gap-1 text-xs text-text-tertiary">
              <Inbox className="h-3 w-3" aria-hidden="true" />
              {localize(brainLabelKeys[entry.key] as Parameters<typeof localize>[0])}
            </span>
          </div>
        ))}
      </div>
      <p className="text-xs text-text-tertiary">{localize('com_ui_brain_hint')}</p>
    </Panel>
  );
}
