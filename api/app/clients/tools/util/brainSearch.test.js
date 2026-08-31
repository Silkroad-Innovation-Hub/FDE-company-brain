const { Tools } = require('librechat-data-provider');
const { createBrainSearchTool, formatHits } = require('./brainSearch');

jest.mock('@librechat/data-schemas', () => ({
  logger: { error: jest.fn(), debug: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

async function call(brainSearch, args) {
  const message = await brainSearch.invoke({
    name: Tools.brain_search,
    args,
    id: `call-${Math.random()}`,
    type: 'tool_call',
  });
  return [message.content, message.artifact];
}

const noteHit = {
  kind: 'note',
  refId: 'Fury',
  title: 'Fury',
  text: 'Fury (YFQ-44A) entered serial production at Arsenal-1 in March 2026.',
  score: 0.8321,
};
const logHit = {
  kind: 'log',
  refId: 'log-1',
  title: 'iMessage',
  text: 'Henderson said the PO clears Friday.',
  score: 0.71,
  surface: 'imessage',
  sender: '+14155550100',
  sourceAt: new Date('2026-08-28T15:00:00Z'),
};

describe('brain_search tool', () => {
  it('formats notes as wikilinks and messages with provenance, and returns an artifact', async () => {
    const retriever = { search: jest.fn(async () => [noteHit, logHit]) };
    const brainSearch = createBrainSearchTool({ userId: 'u1', retriever });
    const [text, artifact] = await call(brainSearch, { query: 'fury production' });

    expect(text).toContain('1. [[Fury]] (note, 0.83)');
    expect(text).toContain('Fury (YFQ-44A) entered serial production');
    expect(text).toContain('2. iMessage from +14155550100 · Aug 28 (recent, 0.71)');
    expect(artifact[Tools.brain_search].hits).toHaveLength(2);
    expect(artifact[Tools.brain_search].hits[0]).toMatchObject({ kind: 'note', refId: 'Fury' });
    expect(retriever.search).toHaveBeenCalledWith('u1', 'fury production', {
      k: 8,
      sources: ['note', 'log'],
    });
  });

  it('maps scope to retrieval sources', async () => {
    const retriever = { search: jest.fn(async () => []) };
    const brainSearch = createBrainSearchTool({ userId: 'u1', retriever });
    await call(brainSearch, { query: 'q', scope: 'brain' });
    await call(brainSearch, { query: 'q', scope: 'recent' });
    expect(retriever.search.mock.calls[0][2].sources).toEqual(['note']);
    expect(retriever.search.mock.calls[1][2].sources).toEqual(['log']);
    const [empty, artifact] = await call(brainSearch, { query: 'q' });
    expect(empty).toMatch(/No brain notes/);
    expect(artifact[Tools.brain_search].hits).toEqual([]);
  });

  it('never throws when the retriever is missing or failing', async () => {
    const missing = createBrainSearchTool({ userId: 'u1', retriever: undefined });
    expect(await call(missing, { query: 'q' })).toEqual([
      'Brain search is not configured on this instance.',
      undefined,
    ]);
    const failing = createBrainSearchTool({
      userId: 'u1',
      retriever: {
        search: async () => {
          throw new Error('boom');
        },
      },
    });
    const [text] = await call(failing, { query: 'q' });
    expect(text).toMatch(/failed/);
  });

  it('exposes the tool name and schema', () => {
    const brainSearch = createBrainSearchTool({ userId: 'u1', retriever: undefined });
    expect(brainSearch.name).toBe(Tools.brain_search);
    expect(formatHits([noteHit])).toBe(
      '1. [[Fury]] (note, 0.83)\nFury (YFQ-44A) entered serial production at Arsenal-1 in March 2026.',
    );
  });
});
