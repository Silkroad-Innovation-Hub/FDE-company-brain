/**
 * The analytics dashboard's headline numbers, rendered as prompt text so channel answers
 * quote the same figures the owner sees at /analytics. Mirrors the sample series in
 * `client/src/components/Analytics/sample.ts` until a client's tools are connected.
 */
const usd = (value: number): string =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);

const CASH_SERIES = [
  ['Mar', 118_400],
  ['Apr', 104_900],
  ['May', 126_300],
  ['Jun', 139_800],
  ['Jul', 131_200],
  ['Aug', 152_600],
] as const;

const REVENUE_SERIES = [
  ['Mar', 64_200, 51_800],
  ['Apr', 58_700, 54_300],
  ['May', 71_900, 55_100],
  ['Jun', 78_400, 58_900],
  ['Jul', 74_100, 60_200],
  ['Aug', 83_600, 61_400],
] as const;

const AGING_BUCKETS = [
  ['current', 24_800],
  ['1-30 days', 13_200],
  ['31-60 days', 7_400],
  ['61-90 days', 4_100],
  ['90+ days', 2_600],
] as const;

const OVERDUE_INVOICES = [
  ['Henderson & Co', 6_400, 47],
  ['Brightline Media', 4_850, 33],
  ['Cobalt Supply', 3_900, 21],
  ['Maple Ridge HOA', 2_600, 94],
  ['Vertex Labs', 1_750, 12],
] as const;

const PAYABLES = [
  ['Payroll (Gusto)', 28_400, 'in 2 days'],
  ['Office lease', 6_200, 'in 5 days'],
  ['Corestock (vendor)', 4_750, 'in 9 days'],
  ['Insurance premium', 1_980, 'in 12 days'],
] as const;

const BANK_ACCOUNTS = [
  ['Mercury Operating (checking)', 118_300],
  ['Mercury Savings (reserve)', 34_300],
  ['Corporate card (credit, closes Aug 28)', -4_820],
] as const;

const SCHEDULE = [
  ['9:00', 'Ops stand-up', 'leadership team'],
  ['11:30', 'Henderson renewal call', 'you + their AP lead'],
  ['14:00', 'Interview — warehouse manager', 'you, Dana'],
  ['16:30', 'Accountant sync', 'you + CPA'],
] as const;

const MONTHLY_BURN = 61_400;
const REVENUE_TARGET = 95_000;
const TIME_SAVED_HOURS = 6.5;
const EMAILS_HANDLED_WEEK = 132;
const INBOX_TRIAGE = { needsReply: 7, handled: 19, fyi: 22, filtered: 41 };
const BRAIN_INDEX = { emails: 12_480, documents: 1_142, invoices: 863, contacts: 402 };

const latestCash = CASH_SERIES[CASH_SERIES.length - 1];
const latestRevenue = REVENUE_SERIES[REVENUE_SERIES.length - 1];
const outstandingAR = AGING_BUCKETS.reduce((total, [, amount]) => total + amount, 0);
const runwayMonths = (latestCash[1] / MONTHLY_BURN).toFixed(1);

const DASHBOARD_LINES = [
  'Dashboard (the /analytics page the owner sees; these figures are exact and current — quote them):',
  `- Monthly burn: ${usd(MONTHLY_BURN)} (August expenses). Revenue target: ${usd(REVENUE_TARGET)}/month.`,
  `- Cash on hand: ${usd(latestCash[1])} (${latestCash[0]}); runway about ${runwayMonths} months at current burn. Cash by month: ${CASH_SERIES.map(([m, c]) => `${m} ${usd(c)}`).join(', ')}.`,
  `- Revenue vs expenses by month: ${REVENUE_SERIES.map(([m, r, e]) => `${m} ${usd(r)} / ${usd(e)}`).join(', ')}. August net: ${usd(latestRevenue[1] - latestRevenue[2])}.`,
  `- Outstanding receivables: ${usd(outstandingAR)} (${AGING_BUCKETS.map(([b, a]) => `${b} ${usd(a)}`).join(', ')}).`,
  `- Overdue invoices: ${OVERDUE_INVOICES.map(([c, a, d]) => `${c} ${usd(a)} (${d} days)`).join(', ')}.`,
  `- Upcoming payables: ${PAYABLES.map(([v, a, d]) => `${v} ${usd(a)} ${d}`).join(', ')}.`,
  `- Bank accounts: ${BANK_ACCOUNTS.map(([n, b]) => `${n} ${usd(b)}`).join(', ')}.`,
  `- Today's schedule: ${SCHEDULE.map(([t, title, who]) => `${t} ${title} (${who})`).join(', ')}.`,
  `- Inbox this week: ${EMAILS_HANDLED_WEEK} emails handled; triage ${INBOX_TRIAGE.needsReply} need reply, ${INBOX_TRIAGE.handled} handled, ${INBOX_TRIAGE.fyi} FYI, ${INBOX_TRIAGE.filtered} filtered. Time saved: ${TIME_SAVED_HOURS} hours/week.`,
  `- Brain index: ${BRAIN_INDEX.emails.toLocaleString('en-US')} emails, ${BRAIN_INDEX.documents.toLocaleString('en-US')} documents, ${BRAIN_INDEX.invoices} invoices, ${BRAIN_INDEX.contacts} contacts.`,
];

export const DASHBOARD_SNAPSHOT = DASHBOARD_LINES.join('\n');
