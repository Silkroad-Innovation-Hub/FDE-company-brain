const path = require('path');
const mongoose = require('mongoose');
require('module-alias')({ base: path.resolve(__dirname, '..', 'api') });
const { createModels } = require('@librechat/data-schemas');
const { silentExit } = require('./helpers');
const connect = require('./connect');

const { User, Agent } = createModels(mongoose);

const agents = [
  {
    id: 'agent_anduril_finance',
    name: 'Anduril Financial Analyst',
    description:
      'Specialist subagent for financial documents: funding rounds, revenue, burn, contract values.',
    provider: 'openAI',
    model: 'gpt-5.5',
    recursion_limit: 30,
    instructions: [
      'You are the Financial Documents Analyst for Anduril Industries, a specialist subagent of Silkroad.',
      'Scope: funding history (Series G $2.5B at $30.5B in June 2025; Series H $5B at $61B in June 2026 led by Thrive Capital and a16z), revenue ($2.2B in 2025, projected $4.3B in 2026), contract economics (Army enterprise contract $20B ceiling, IVAS program up to $22B, CCA production), and capital deployment (Arsenal-1: $1B, 5M sq ft).',
      'Always answer with numbers first, then interpretation. Flag any figure you are not certain of. Never fabricate financial data — say what is unknown.',
      'You have no payment or transaction authority of any kind; you analyze documents only.',
    ].join('\n'),
  },
  {
    id: 'agent_anduril_programs',
    name: 'Anduril Programs & Contracts Analyst',
    description:
      'Specialist subagent for defense programs: CCA/Fury, IVAS/EagleEye, Army counter-UAS, Ghost Shark.',
    provider: 'openAI',
    model: 'gpt-5.5',
    recursion_limit: 30,
    instructions: [
      'You are the Programs & Contracts Analyst for Anduril Industries, a specialist subagent of Silkroad.',
      'Scope: the CCA program (Fury YFQ-44A, serial production at Arsenal-1 since March 2026, ~3 months early), IVAS/Soldier-Borne Mission Command taken over from Microsoft in Feb 2025 (EagleEye with Meta), the March 2026 $20B Army enterprise contract consolidating 120+ orders around Lattice, Ghost Shark with Australia, and the Rheinmetall European channel.',
      'Answer with program status, key dates, counterparties, and risks. Distinguish confirmed milestones from projections. Never fabricate program facts — say what is unknown.',
    ].join('\n'),
  },
];

(async () => {
  await connect();
  const user = await User.findOne({ email: 'amirkhanaidarkhan06@gmail.com' }).lean();
  if (!user) {
    console.error('Seed user not found — create the login user first.');
    silentExit(1);
  }
  for (const agent of agents) {
    await Agent.findOneAndUpdate(
      { id: agent.id },
      { ...agent, author: user._id },
      { upsert: true, new: true },
    );
    console.log(`Upserted ${agent.id} (${agent.name})`);
  }
  silentExit(0);
})();
