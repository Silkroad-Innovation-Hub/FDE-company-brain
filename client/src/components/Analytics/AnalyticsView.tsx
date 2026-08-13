import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { useTodosQuery } from '~/data-provider';
import { CashChart, TriageDonut, RevenueChart, ARAgingChart, ActivityChart } from './FinanceCharts';
import {
  Schedule,
  Payables,
  Approvals,
  ActivityFeed,
  BankAccounts,
  OverdueInvoices,
} from './Lists';
import BrainExplorer from './Brain';
import {
  formatCurrency,
  sampleCashSeries,
  sampleMonthlyBurn,
  sampleRevenueTarget,
  sampleRevenueSeries,
  sampleOutstandingAR,
  sampleTimeSavedHours,
  sampleEmailsHandledWeek,
} from './sample';
import { useLocalize } from '~/hooks';
import ViewToggle from './ViewToggle';
import TodoList from './TodoList';

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-border-light bg-surface-primary p-4 shadow-sm">
      <span className="text-xs uppercase tracking-wide text-text-tertiary">{label}</span>
      <span className="text-xl font-semibold text-text-primary xl:text-2xl">{value}</span>
      {hint != null && <span className="text-xs text-text-tertiary">{hint}</span>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-text-tertiary">{title}</h2>
      {children}
    </section>
  );
}

export default function AnalyticsView() {
  const localize = useLocalize();
  const { data: todos } = useTodosQuery();

  const openTodoCount = useMemo(
    () => (todos ?? []).reduce((count, todo) => count + (todo.done ? 0 : 1), 0),
    [todos],
  );

  const latestCash = sampleCashSeries[sampleCashSeries.length - 1].cash;
  const latestRevenue = sampleRevenueSeries[sampleRevenueSeries.length - 1].revenue;
  const runwayMonths = (latestCash / sampleMonthlyBurn).toFixed(1);
  const targetPercent = Math.round((latestRevenue / sampleRevenueTarget) * 100);

  return (
    <div className="h-full w-full overflow-y-auto bg-surface-primary">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 p-4 md:p-8">
        <header className="flex items-center justify-between gap-4">
          <h1 className="text-xl font-semibold text-text-primary">
            {localize('com_ui_analytics')}
          </h1>
          <ViewToggle current="analytics" />
        </header>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat
            label={localize('com_ui_cash_on_hand')}
            value={formatCurrency(latestCash)}
            hint={localize('com_ui_sample_data')}
          />
          <Stat
            label={localize('com_ui_runway')}
            value={localize('com_ui_runway_months', { 0: runwayMonths })}
            hint={localize('com_ui_runway_hint', { 0: formatCurrency(sampleMonthlyBurn) })}
          />
          <Stat
            label={localize('com_ui_outstanding_ar')}
            value={formatCurrency(sampleOutstandingAR)}
            hint={localize('com_ui_sample_data')}
          />
          <Stat
            label={localize('com_ui_revenue')}
            value={formatCurrency(latestRevenue)}
            hint={localize('com_ui_target_percent', { 0: String(targetPercent) })}
          />
          <Stat
            label={localize('com_ui_monthly_burn')}
            value={formatCurrency(sampleMonthlyBurn)}
            hint={localize('com_ui_sample_data')}
          />
          <Stat
            label={localize('com_ui_time_saved')}
            value={localize('com_ui_hours_short', { 0: String(sampleTimeSavedHours) })}
            hint={localize('com_ui_this_week')}
          />
          <Stat
            label={localize('com_ui_emails_handled')}
            value={String(sampleEmailsHandledWeek)}
            hint={localize('com_ui_this_week')}
          />
          <Stat
            label={localize('com_ui_open_tasks')}
            value={String(openTodoCount)}
            hint={localize('com_ui_live_data')}
          />
        </div>

        <Section title={localize('com_ui_company_brain')}>
          <BrainExplorer />
        </Section>

        <Section title={localize('com_ui_section_finance')}>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <CashChart />
            </div>
            <ARAgingChart />
            <div className="lg:col-span-2">
              <RevenueChart />
            </div>
            <OverdueInvoices />
            <BankAccounts />
            <Payables />
          </div>
        </Section>

        <Section title={localize('com_ui_section_hermes')}>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <ActivityChart />
            </div>
            <TriageDonut />
            <Approvals />
            <div className="lg:col-span-2">
              <ActivityFeed />
            </div>
          </div>
        </Section>

        <Section title={localize('com_ui_section_today')}>
          <div className="grid grid-cols-1 gap-6 pb-8 lg:grid-cols-3">
            <Schedule />
            <div className="lg:col-span-2">
              <TodoList />
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}
