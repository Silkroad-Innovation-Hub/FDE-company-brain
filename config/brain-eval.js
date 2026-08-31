const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const { createModels, createMethods, logger } = require('@librechat/data-schemas');
const { createBrainEmbed, createBrainRetriever } = require('@librechat/api');
const connect = require('./connect');

/**
 * Retrieval eval over the demo vault: each question names the note that must
 * land in the top 3. Run before a demo; exits non-zero below PASS_THRESHOLD.
 *   npm run brain:eval
 *   npm run brain:eval -- --question "who founded the company"
 */
const CASES = [
  { question: 'Who founded the company and when?', expected: 'Anduril' },
  { question: 'Where is Fury built and when did serial production start?', expected: 'Arsenal-1' },
  { question: 'What is the YFQ-44A collaborative combat aircraft?', expected: 'Fury' },
  {
    question: 'How much did we raise in the latest funding round and at what valuation?',
    expected: 'Series H',
  },
  { question: 'What was revenue last year and the projection for this year?', expected: 'Revenue' },
  {
    question: 'Tell me about the $20B Army counter-UAS contract',
    expected: 'Army Enterprise Contract',
  },
  {
    question: 'What is the soldier headset program we took over from Microsoft?',
    expected: 'IVAS',
  },
  { question: 'What is Lattice?', expected: 'Lattice' },
  { question: 'Who is the CEO?', expected: 'Brian Schimpf' },
  { question: 'Which companies have we acquired?', expected: 'Acquisitions' },
  { question: 'Who are our main competitors?', expected: 'Competitors' },
  { question: 'What is the autonomous submarine program?', expected: 'Ghost Shark' },
];
const PASS_THRESHOLD = 10;
const TOP_K = 3;

const vaultPath = process.env.BRAIN_VAULT_PATH || path.resolve(__dirname, '..', 'brain');
const parseNumber = (value, fallback) =>
  value !== undefined && Number.isFinite(Number(value)) ? Number(value) : fallback;
const logDays = parseNumber(process.env.BRAIN_RETRIEVAL_LOG_DAYS, 90);
const maxVectors = parseNumber(process.env.BRAIN_RETRIEVAL_MAX_VECTORS, 20_000);

function adHocQuestion() {
  const index = process.argv.indexOf('--question');
  return index === -1
    ? null
    : process.argv
        .slice(index + 1)
        .join(' ')
        .trim();
}

function pad(text, width) {
  return String(text).padEnd(width).slice(0, width);
}

(async () => {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required for the retrieval eval');
  }
  await connect();
  createModels(mongoose);
  const methods = createMethods(mongoose);
  const ownerEmail = process.env.SILKROAD_USER_EMAIL;
  const owner = ownerEmail ? await methods.findUser({ email: ownerEmail }, '_id') : null;
  if (!owner) {
    throw new Error('SILKROAD_USER_EMAIL is unset or the user does not exist');
  }
  const ownerId = String(owner._id);
  const retriever = createBrainRetriever({
    methods,
    embed: createBrainEmbed({
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.BRAIN_EMBED_MODEL,
    }),
    logger,
    options: { logDays, maxVectors, embedModel: process.env.BRAIN_EMBED_MODEL },
  });
  const synced = await retriever.syncVault(ownerId, vaultPath);
  console.log(
    `vault: ${synced.indexed} chunks embedded, ${synced.unchanged} unchanged, ${synced.removed} removed\n`,
  );

  const question = adHocQuestion();
  if (question) {
    const hits = await retriever.search(ownerId, question, { k: 5 });
    for (const hit of hits) {
      console.log(`${hit.score.toFixed(2)}  ${hit.kind.padEnd(4)}  ${hit.title}`);
    }
    await mongoose.disconnect();
    return;
  }

  let passed = 0;
  console.log(`${pad('question', 58)} ${pad('expected', 24)} ${pad('top note', 24)} score`);
  for (const testCase of CASES) {
    const hits = await retriever.search(ownerId, testCase.question, {
      k: TOP_K,
      sources: ['note'],
    });
    const top = hits[0];
    const hit = hits.some((candidate) => candidate.title === testCase.expected);
    passed += hit ? 1 : 0;
    console.log(
      `${hit ? '✓' : '✗'} ${pad(testCase.question, 56)} ${pad(testCase.expected, 24)} ${pad(top?.title ?? '—', 24)} ${top ? top.score.toFixed(2) : ''}`,
    );
  }
  console.log(`\n${passed}/${CASES.length} in top ${TOP_K} (threshold ${PASS_THRESHOLD})`);
  await mongoose.disconnect();
  process.exit(passed >= PASS_THRESHOLD ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
