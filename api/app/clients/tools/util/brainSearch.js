const { z } = require('zod');
const { logger } = require('@librechat/data-schemas');
const { tool } = require('@librechat/agents/langchain/tools');
const { Tools } = require('librechat-data-provider');

const HIT_LIMIT = 8;
const SCOPE_SOURCES = {
  brain: ['note'],
  recent: ['log'],
  all: ['note', 'log'],
};

const brainSearchSchema = z.object({
  query: z
    .string()
    .describe(
      'What to look up in the company brain: a person, company, deal, program, number, decision, or something the owner said recently. Be specific.',
    ),
  scope: z
    .enum(['brain', 'recent', 'all'])
    .optional()
    .describe(
      "'brain' searches only the curated notes; 'recent' searches only recent messages across chat, iMessage and email; 'all' (default) searches both.",
    ),
});

const SURFACE_LABELS = { imessage: 'iMessage', email: 'email', chat: 'chat' };

function formatDate(value) {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** One heading per hit: `[[Note]] (note, 0.83)` or `iMessage from +1… · Aug 28 (recent, 0.71)`. */
function formatHeading(hit) {
  const score = hit.score.toFixed(2);
  if (hit.kind === 'note') {
    return `[[${hit.title}]] (note, ${score})`;
  }
  const surface = SURFACE_LABELS[hit.surface] ?? hit.surface ?? 'message';
  const from = hit.sender ? ` from ${hit.sender}` : '';
  const date = formatDate(hit.sourceAt);
  return `${surface}${from}${date ? ` · ${date}` : ''} (recent, ${score})`;
}

function formatHits(hits) {
  return hits.map((hit, index) => `${index + 1}. ${formatHeading(hit)}\n${hit.text}`).join('\n\n');
}

/**
 * Company-brain search over curated notes and the recent raw log. The
 * retriever is the process-wide `BrainRetriever` (app.locals.brainRetriever);
 * when it is absent the tool degrades to a plain notice instead of throwing.
 *
 * @param {{ userId: string, retriever?: import('@librechat/api').BrainRetriever }} params
 */
function createBrainSearchTool({ userId, retriever }) {
  return tool(
    async ({ query, scope }) => {
      if (!retriever) {
        return ['Brain search is not configured on this instance.', undefined];
      }
      const sources = SCOPE_SOURCES[scope ?? 'all'] ?? SCOPE_SOURCES.all;
      let hits;
      try {
        hits = await retriever.search(userId, query, { k: HIT_LIMIT, sources });
      } catch (error) {
        logger.error(`[${Tools.brain_search}] search failed`, error);
        return ['Brain search failed; answer from the conversation only.', undefined];
      }
      if (hits.length === 0) {
        return [
          'No brain notes or recent messages matched the query.',
          { [Tools.brain_search]: { hits: [] } },
        ];
      }
      const artifact = {
        hits: hits.map((hit) => ({
          kind: hit.kind,
          refId: hit.refId,
          title: hit.title,
          score: hit.score,
          surface: hit.surface,
          sender: hit.sender,
          sourceAt: hit.sourceAt,
        })),
      };
      return [formatHits(hits), { [Tools.brain_search]: artifact }];
    },
    {
      name: Tools.brain_search,
      responseFormat: 'content_and_artifact',
      description:
        'Searches the company brain — the curated notes and recent messages across chat, iMessage and email. Returns numbered hits with [[Note Title]] citations for notes and sender/date provenance for messages. Call it before answering questions about the company, its people, deals, programs, numbers, or anything the owner previously said.',
      schema: brainSearchSchema,
    },
  );
}

module.exports = { createBrainSearchTool, brainSearchSchema, formatHits };
