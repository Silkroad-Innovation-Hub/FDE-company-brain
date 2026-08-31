/**
 * Manual acceptance run against the real embeddings API and the demo vault.
 * Ignored by Jest's default patterns; run by hand:
 *   OPENAI_API_KEY=... npx jest src/brain/retrieval/retrieval.manual.spec.ts --testPathIgnorePatterns=none
 */
import path from 'path';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createModels, createMethods } from '@librechat/data-schemas';
import { createBrainRetriever } from './index';
import { createBrainEmbed } from '~/brain/openai';

const QUESTIONS: Array<[string, string]> = [
  ['What is Anduril valued at after the latest round?', 'Series H'],
  ['Who founded the company?', 'Anduril'],
  ['How big is the Army enterprise contract?', 'Army Enterprise Contract'],
  ['Where is Fury built?', 'Arsenal-1'],
  ['What does Lattice do?', 'Lattice'],
  ['Tell me about the IVAS program', 'IVAS'],
  ['Who is Brian Schimpf?', 'Brian Schimpf'],
  ['What was revenue in 2025?', 'Revenue'],
  ['Which companies has Anduril acquired?', 'Acquisitions'],
  ['Who are the main competitors?', 'Competitors'],
  ['What is Ghost Shark?', 'Ghost Shark'],
  ['What is the manufacturing strategy?', 'Manufacturing Strategy'],
];

const apiKey = process.env.OPENAI_API_KEY;
const describeIf = apiKey ? describe : describe.skip;

describeIf('retrieval over the demo vault (real embeddings)', () => {
  let mongoServer: InstanceType<typeof MongoMemoryServer>;
  const user = new mongoose.Types.ObjectId().toString();
  const vaultPath = path.resolve(__dirname, '..', '..', '..', '..', '..', 'brain');

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    createModels(mongoose);
    await mongoose.connect(mongoServer.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  it('puts the expected note in the top 3 for every demo question', async () => {
    const methods = createMethods(mongoose);
    const retriever = createBrainRetriever({
      methods,
      embed: createBrainEmbed({ apiKey }),
      logger: { info: console.log, warn: console.warn },
    });
    const synced = await retriever.syncVault(user, vaultPath);
    console.log('synced', synced);
    const misses: string[] = [];
    for (const [question, expected] of QUESTIONS) {
      const hits = await retriever.search(user, question, { k: 3, sources: ['note'] });
      const titles = hits.map((hit) => `${hit.refId} (${hit.score.toFixed(2)})`);
      console.log(question, '→', titles.join(', '));
      if (!hits.some((hit) => hit.refId === expected)) {
        misses.push(`${question} → expected ${expected}, got ${titles.join(', ')}`);
      }
    }
    expect(misses).toEqual([]);
  }, 120_000);
});
