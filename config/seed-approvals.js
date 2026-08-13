const path = require('path');
const mongoose = require('mongoose');
require('module-alias')({ base: path.resolve(__dirname, '..', 'api') });
const { createModels } = require('@librechat/data-schemas');
const { silentExit } = require('./helpers');
const connect = require('./connect');

const { User, Approval } = createModels(mongoose);

const approvals = [
  {
    kind: 'email',
    title: 'Invoice chase — Henderson & Co',
    description: 'Polite reminder, $6,400 overdue 47 days',
    payload: {
      to: 'accounts@hendersonco.com',
      cc: 'you@yourcompany.com',
      subject: 'Friendly reminder: Invoice #1082 — $6,400 past due',
      body: [
        'Hi Marcus,',
        '',
        'Hope things are going well on your end. I wanted to flag that Invoice #1082 for $6,400, issued on June 27, is now 47 days past due.',
        '',
        'Could you let me know when we can expect payment, or if anything is holding it up on your side? Happy to resend the invoice or hop on a quick call if that helps.',
        '',
        'Thanks so much,',
        'Amir',
      ].join('\n'),
    },
  },
  {
    kind: 'message',
    title: 'Confirm 4:30 accountant sync',
    description: 'iMessage to Sarah Lin (CPA) confirming today’s call',
    payload: {
      channel: 'iMessage',
      recipient: 'Sarah Lin (CPA)',
      text: 'Hi Sarah — confirming our 4:30pm sync today. I’ll bring the July P&L and the updated AR aging. Anything else you want me to pull beforehand?',
    },
  },
  {
    kind: 'document',
    title: 'Q3 forecast update — QuickBooks',
    description: 'Revenue target and contractor budget revised from July actuals',
    payload: {
      document: 'QuickBooks · Q3 Cash-Flow Forecast',
      summary:
        'July closed 8% above plan while contractor spend came in under budget. The forecast is updated so runway and the September target reflect actuals.',
      changes: [
        { field: 'September revenue target', before: '$92,000', after: '$95,000' },
        { field: 'Contractor budget (monthly)', before: '$18,500', after: '$16,200' },
        { field: 'Projected September cash', before: '$148,900', after: '$156,400' },
      ],
    },
  },
  {
    kind: 'email',
    title: 'Second notice — Maple Ridge HOA',
    description: 'Firmer follow-up, $2,600 overdue 94 days',
    payload: {
      to: 'treasurer@mapleridgehoa.org',
      subject: 'Second notice: Invoice #1044 — $2,600 outstanding (94 days)',
      body: [
        'Hello Patricia,',
        '',
        'Following up on my note from three weeks ago — Invoice #1044 for $2,600 remains unpaid after 94 days.',
        '',
        'We value the relationship with Maple Ridge, but we do need to resolve this balance. Could you confirm a payment date this week? If the board needs any documentation to release payment, send me the request and I will turn it around same day.',
        '',
        'Best regards,',
        'Amir',
      ].join('\n'),
    },
  },
];

(async () => {
  await connect();
  const user = await User.findOne({ email: 'amirkhanaidarkhan06@gmail.com' }).lean();
  if (!user) {
    console.error('Seed user not found — create the login user first.');
    silentExit(1);
  }
  for (const approval of approvals) {
    await Approval.findOneAndUpdate(
      { user: user._id.toString(), title: approval.title },
      { ...approval, user: user._id.toString(), status: 'pending', decidedAt: null },
      { upsert: true, new: true },
    );
    console.log(`Upserted approval: ${approval.title}`);
  }
  silentExit(0);
})();
