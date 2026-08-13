import {
  Pie,
  Bar,
  Area,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  BarChart,
  PieChart,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
} from 'recharts';
import { useLocalize } from '~/hooks';
import {
  chartPalette,
  sampleTriage,
  formatCurrency,
  sampleCashSeries,
  sampleAgingBuckets,
  sampleRevenueSeries,
  sampleWeeklyActivity,
  formatCompactCurrency,
} from './sample';
import Panel from './Panel';

const axisTick = { fill: 'currentColor', fontSize: 12 };

const tooltipContentStyle = {
  borderRadius: '0.75rem',
  border: '1px solid var(--border-light, #e5e5e5)',
  backgroundColor: 'var(--surface-primary, #ffffff)',
  color: 'var(--text-primary, #171717)',
  fontSize: '0.8rem',
};

const currencyTooltip = (value: number | string) => formatCurrency(Number(value));

export function CashChart() {
  const localize = useLocalize();
  return (
    <Panel title={localize('com_ui_cash_position')} isSample>
      <div className="h-56 text-text-tertiary">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={sampleCashSeries} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
            <defs>
              <linearGradient id="cash-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={chartPalette.primary} stopOpacity={0.35} />
                <stop offset="100%" stopColor={chartPalette.primary} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.15} />
            <XAxis dataKey="month" tick={axisTick} tickLine={false} axisLine={false} />
            <YAxis
              tick={axisTick}
              tickLine={false}
              axisLine={false}
              width={52}
              tickFormatter={formatCompactCurrency}
            />
            <Tooltip contentStyle={tooltipContentStyle} formatter={currencyTooltip} />
            <Area
              isAnimationActive={false}
              type="monotone"
              dataKey="cash"
              name={localize('com_ui_cash_on_hand')}
              stroke={chartPalette.primary}
              strokeWidth={2}
              fill="url(#cash-fill)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}

export function RevenueChart() {
  const localize = useLocalize();
  return (
    <Panel title={localize('com_ui_revenue_vs_expenses')} isSample>
      <div className="h-56 text-text-tertiary">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={sampleRevenueSeries} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.15} />
            <XAxis dataKey="month" tick={axisTick} tickLine={false} axisLine={false} />
            <YAxis
              tick={axisTick}
              tickLine={false}
              axisLine={false}
              width={52}
              tickFormatter={formatCompactCurrency}
            />
            <Tooltip
              contentStyle={tooltipContentStyle}
              formatter={currencyTooltip}
              cursor={{ fill: 'currentColor', opacity: 0.06 }}
            />
            <Bar
              isAnimationActive={false}
              dataKey="revenue"
              name={localize('com_ui_revenue')}
              fill={chartPalette.primary}
              radius={[4, 4, 0, 0]}
            />
            <Bar
              isAnimationActive={false}
              dataKey="expenses"
              name={localize('com_ui_expenses')}
              fill={chartPalette.secondary}
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}

export function ARAgingChart() {
  const localize = useLocalize();
  return (
    <Panel title={localize('com_ui_ar_aging')} isSample>
      <div className="h-56 text-text-tertiary">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={sampleAgingBuckets}
            layout="vertical"
            margin={{ top: 4, right: 12, left: 4, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.15} />
            <XAxis
              type="number"
              tick={axisTick}
              tickLine={false}
              axisLine={false}
              tickFormatter={formatCompactCurrency}
            />
            <YAxis
              type="category"
              dataKey="bucket"
              tick={axisTick}
              tickLine={false}
              axisLine={false}
              width={56}
            />
            <Tooltip
              contentStyle={tooltipContentStyle}
              formatter={currencyTooltip}
              cursor={{ fill: 'currentColor', opacity: 0.06 }}
            />
            <Bar
              isAnimationActive={false}
              dataKey="amount"
              name={localize('com_ui_outstanding_ar')}
              fill={chartPalette.primary}
              radius={[0, 4, 4, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}

export function ActivityChart() {
  const localize = useLocalize();
  return (
    <Panel title={localize('com_ui_hermes_activity')} isSample>
      <div className="h-56 text-text-tertiary">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={sampleWeeklyActivity} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.15} />
            <XAxis dataKey="day" tick={axisTick} tickLine={false} axisLine={false} />
            <YAxis
              tick={axisTick}
              tickLine={false}
              axisLine={false}
              width={32}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={tooltipContentStyle}
              cursor={{ fill: 'currentColor', opacity: 0.06 }}
            />
            <Bar
              isAnimationActive={false}
              dataKey="answered"
              name={localize('com_ui_questions_answered')}
              fill={chartPalette.tertiary}
              radius={[3, 3, 0, 0]}
            />
            <Bar
              isAnimationActive={false}
              dataKey="drafted"
              name={localize('com_ui_emails_drafted')}
              fill={chartPalette.primary}
              radius={[3, 3, 0, 0]}
            />
            <Bar
              isAnimationActive={false}
              dataKey="sent"
              name={localize('com_ui_emails_sent')}
              fill={chartPalette.secondary}
              radius={[3, 3, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-xs text-text-secondary">
        <LegendDot color={chartPalette.tertiary} label={localize('com_ui_questions_answered')} />
        <LegendDot color={chartPalette.primary} label={localize('com_ui_emails_drafted')} />
        <LegendDot color={chartPalette.secondary} label={localize('com_ui_emails_sent')} />
      </div>
    </Panel>
  );
}

const triageLabelKeys: Record<string, string> = {
  needs_reply: 'com_ui_triage_needs_reply',
  handled: 'com_ui_triage_handled',
  fyi: 'com_ui_triage_fyi',
  filtered: 'com_ui_triage_filtered',
};

export function TriageDonut() {
  const localize = useLocalize();
  const total = sampleTriage.reduce((sum, slice) => sum + slice.count, 0);
  return (
    <Panel title={localize('com_ui_inbox_triage_today')} isSample>
      <div className="flex items-center gap-4">
        <div className="relative h-40 w-40 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                isAnimationActive={false}
                data={sampleTriage}
                dataKey="count"
                nameKey="key"
                innerRadius={52}
                outerRadius={72}
                paddingAngle={2}
                stroke="none"
              >
                {sampleTriage.map((slice) => (
                  <Cell key={slice.key} fill={slice.color} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-semibold text-text-primary">{total}</span>
            <span className="text-xs text-text-tertiary">{localize('com_ui_emails')}</span>
          </div>
        </div>
        <ul className="flex min-w-0 flex-1 flex-col gap-2">
          {sampleTriage.map((slice) => (
            <li key={slice.key} className="flex items-center justify-between gap-2 text-sm">
              <LegendDot
                color={slice.color}
                label={localize(triageLabelKeys[slice.key] as Parameters<typeof localize>[0])}
              />
              <span className="font-medium text-text-primary">{slice.count}</span>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-text-secondary">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <span className="truncate">{label}</span>
    </span>
  );
}
