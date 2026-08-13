export type CashPoint = { month: string; cash: number };
export type AgingBucket = { bucket: string; amount: number };
export type RevenuePoint = { month: string; revenue: number; expenses: number };
export type ActivityPoint = { day: string; drafted: number; sent: number; answered: number };
export type TriageSlice = { key: string; count: number; color: string };
export type OverdueInvoice = { client: string; amount: number; daysOverdue: number };
export type Payable = { vendor: string; amount: number; dueIn: string };
export type BankAccount = { name: string; kind: string; balance: number };
export type ScheduleItem = { time: string; title: string; attendees: string };
export type FeedItem = {
  type: 'sent' | 'drafted' | 'task' | 'indexed' | 'brief' | 'chased';
  text: string;
  time: string;
};

/**
 * Placeholder operational and financial series shown until a client's tools
 * (QuickBooks, Mercury, Gmail, calendar) are connected. Always rendered with
 * a visible "Sample data" badge.
 */
export const sampleCashSeries: CashPoint[] = [
  { month: 'Mar', cash: 118_400 },
  { month: 'Apr', cash: 104_900 },
  { month: 'May', cash: 126_300 },
  { month: 'Jun', cash: 139_800 },
  { month: 'Jul', cash: 131_200 },
  { month: 'Aug', cash: 152_600 },
];

export const sampleAgingBuckets: AgingBucket[] = [
  { bucket: 'Current', amount: 24_800 },
  { bucket: '1–30', amount: 13_200 },
  { bucket: '31–60', amount: 7_400 },
  { bucket: '61–90', amount: 4_100 },
  { bucket: '90+', amount: 2_600 },
];

export const sampleRevenueSeries: RevenuePoint[] = [
  { month: 'Mar', revenue: 64_200, expenses: 51_800 },
  { month: 'Apr', revenue: 58_700, expenses: 54_300 },
  { month: 'May', revenue: 71_900, expenses: 55_100 },
  { month: 'Jun', revenue: 78_400, expenses: 58_900 },
  { month: 'Jul', revenue: 74_100, expenses: 60_200 },
  { month: 'Aug', revenue: 83_600, expenses: 61_400 },
];

export const sampleMonthlyBurn = 61_400;
export const sampleRevenueTarget = 95_000;
export const sampleTimeSavedHours = 6.5;
export const sampleEmailsHandledWeek = 132;

export const sampleWeeklyActivity: ActivityPoint[] = [
  { day: 'Thu', drafted: 9, sent: 6, answered: 11 },
  { day: 'Fri', drafted: 12, sent: 8, answered: 14 },
  { day: 'Sat', drafted: 3, sent: 1, answered: 5 },
  { day: 'Sun', drafted: 2, sent: 1, answered: 4 },
  { day: 'Mon', drafted: 14, sent: 10, answered: 17 },
  { day: 'Tue', drafted: 11, sent: 9, answered: 13 },
  { day: 'Wed', drafted: 13, sent: 7, answered: 16 },
];

export const sampleOverdueInvoices: OverdueInvoice[] = [
  { client: 'Henderson & Co', amount: 6_400, daysOverdue: 47 },
  { client: 'Brightline Media', amount: 4_850, daysOverdue: 33 },
  { client: 'Cobalt Supply', amount: 3_900, daysOverdue: 21 },
  { client: 'Maple Ridge HOA', amount: 2_600, daysOverdue: 94 },
  { client: 'Vertex Labs', amount: 1_750, daysOverdue: 12 },
];

export const samplePayables: Payable[] = [
  { vendor: 'Payroll (Gusto)', amount: 28_400, dueIn: 'in 2 days' },
  { vendor: 'Office lease', amount: 6_200, dueIn: 'in 5 days' },
  { vendor: 'Vendor: Corestock', amount: 4_750, dueIn: 'in 9 days' },
  { vendor: 'Insurance premium', amount: 1_980, dueIn: 'in 12 days' },
];

export const sampleBankAccounts: BankAccount[] = [
  { name: 'Mercury Operating', kind: 'Checking', balance: 118_300 },
  { name: 'Mercury Savings', kind: 'Reserve', balance: 34_300 },
  { name: 'Corporate card', kind: 'Credit · closes Aug 28', balance: -4_820 },
];

export const sampleSchedule: ScheduleItem[] = [
  { time: '9:00', title: 'Ops stand-up', attendees: 'Leadership team' },
  { time: '11:30', title: 'Henderson renewal call', attendees: 'You + their AP lead' },
  { time: '14:00', title: 'Interview — warehouse manager', attendees: 'You, Dana' },
  { time: '16:30', title: 'Accountant sync', attendees: 'You + CPA' },
];

export const sampleFeed: FeedItem[] = [
  {
    type: 'sent',
    text: 'Sent approved reply to Cobalt Supply re: delivery window',
    time: '12 min ago',
  },
  {
    type: 'drafted',
    text: 'Drafted invoice chase for Henderson & Co — awaiting approval',
    time: '18 min ago',
  },
  { type: 'task', text: 'Marked “Send updated W-9 to Brightline” as done', time: '54 min ago' },
  {
    type: 'indexed',
    text: 'Indexed 14 new invoices from QuickBooks into the company brain',
    time: '1 hr ago',
  },
  { type: 'drafted', text: 'Drafted reply to Brightline scope question', time: '1 hr ago' },
  {
    type: 'chased',
    text: 'Flagged Maple Ridge HOA — 94 days overdue, third follow-up suggested',
    time: '2 hrs ago',
  },
  { type: 'brief', text: 'Delivered the 7am morning brief', time: '7 hrs ago' },
  { type: 'indexed', text: 'Indexed 96 emails and 3 contracts overnight', time: '9 hrs ago' },
];

export const sampleTriage: TriageSlice[] = [
  { key: 'needs_reply', count: 7, color: '#C9A96A' },
  { key: 'handled', count: 19, color: '#7C8DA6' },
  { key: 'fyi', count: 22, color: '#8A9B8E' },
  { key: 'filtered', count: 41, color: '#5C5C5C' },
];

export const sampleBrainIndex = [
  { key: 'emails', count: 12_480 },
  { key: 'documents', count: 1_142 },
  { key: 'invoices', count: 863 },
  { key: 'contacts', count: 402 },
];

export const sampleOutstandingAR = sampleAgingBuckets.reduce(
  (total, { amount }) => total + amount,
  0,
);

export const formatCurrency = (value: number): string =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);

export const formatCompactCurrency = (value: number): string =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);

/**
 * Chart series colors are a deliberate custom-CSS exception: SVG presentation
 * attributes cannot resolve theme CSS variables, so the brand accent and two
 * mid-tones legible on both light and dark surfaces are fixed here. Axis and
 * grid strokes inherit `currentColor` from themed containers instead.
 */
export const chartPalette = {
  primary: '#C9A96A',
  secondary: '#7C8DA6',
  muted: '#9A9A9A',
  tertiary: '#8A9B8E',
};
