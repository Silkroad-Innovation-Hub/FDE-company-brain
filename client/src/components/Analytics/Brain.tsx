import { useMemo, useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { X, Search } from 'lucide-react';
import { forceLink, forceManyBody, forceCollide, forceCenter, forceSimulation } from 'd3-force';
import type { SimulationNodeDatum } from 'd3-force';
import type { TBrainGraph } from 'librechat-data-provider';
import { useBrainGraphQuery, useBrainNoteQuery } from '~/data-provider';
import { useLocalize } from '~/hooks';

const GRAPH_WIDTH = 960;
const GRAPH_HEIGHT = 620;

/**
 * Node type colors are part of the chart-palette custom-CSS exception (see
 * sample.ts): SVG presentation attributes cannot resolve theme variables.
 */
const typeColors: Record<string, string> = {
  company: '#C9A96A',
  product: '#7C8DA6',
  program: '#8A9B8E',
  finance: '#B8869B',
  person: '#C98A6A',
  facility: '#6AA9C9',
  org: '#9A8FC9',
  intel: '#8F8F73',
};

const fallbackColor = '#8A8A8A';

interface LayoutNode extends SimulationNodeDatum {
  id: string;
  type: string;
  degree: number;
}

interface LayoutLink {
  source: LayoutNode;
  target: LayoutNode;
}

function useGraphLayout(graph?: TBrainGraph) {
  return useMemo(() => {
    if (!graph) {
      return { nodes: [] as LayoutNode[], links: [] as LayoutLink[] };
    }
    const nodes: LayoutNode[] = graph.nodes.map((node) => ({ ...node }));
    const links = graph.links.map((link) => ({ ...link }));
    const simulation = forceSimulation(nodes)
      .force(
        'link',
        forceLink(links)
          .id((node) => (node as LayoutNode).id)
          .distance(80)
          .strength(0.4),
      )
      .force('charge', forceManyBody().strength(-320))
      .force('center', forceCenter(GRAPH_WIDTH / 2, GRAPH_HEIGHT / 2))
      .force(
        'collide',
        forceCollide<LayoutNode>().radius((node) => 14 + Math.sqrt(node.degree) * 3),
      )
      .stop();
    simulation.tick(300);
    return { nodes, links: links as unknown as LayoutLink[] };
  }, [graph]);
}

function nodeRadius(degree: number): number {
  return 6 + Math.sqrt(degree) * 2.4;
}

const wikilinkPattern = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

function wikilinksToMarkdown(content: string): string {
  return content.replace(
    wikilinkPattern,
    (_match, target: string, label?: string) =>
      `[${label ?? target}](#brain:${encodeURIComponent(target.trim())})`,
  );
}

function NoteReader({
  noteId,
  onNavigate,
  onClose,
}: {
  noteId: string;
  onNavigate: (noteId: string) => void;
  onClose: () => void;
}) {
  const localize = useLocalize();
  const { data: note, isLoading } = useBrainNoteQuery(noteId);

  const markdown = useMemo(() => (note ? wikilinksToMarkdown(note.content) : ''), [note]);

  return (
    <aside
      aria-label={noteId}
      className="flex h-full w-full flex-col overflow-hidden border-border-light lg:w-[380px] lg:shrink-0 lg:border-l"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border-light px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: typeColors[note?.type ?? ''] ?? fallbackColor }}
          />
          <h3 className="truncate text-sm font-semibold text-text-primary">{noteId}</h3>
        </div>
        <button
          type="button"
          aria-label={localize('com_ui_close')}
          onClick={onClose}
          className="rounded p-1 text-text-tertiary hover:text-text-primary"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {isLoading ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            {[0, 1, 2, 3].map((row) => (
              <div key={row} className="h-4 animate-pulse rounded bg-surface-secondary" />
            ))}
          </div>
        ) : (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h1: ({ children }) => (
                <h1 className="mb-2 text-lg font-semibold text-text-primary">{children}</h1>
              ),
              h2: ({ children }) => (
                <h2 className="mb-1.5 mt-4 text-sm font-semibold text-text-primary">{children}</h2>
              ),
              p: ({ children }) => (
                <p className="mb-2.5 text-sm leading-relaxed text-text-secondary">{children}</p>
              ),
              ul: ({ children }) => (
                <ul className="mb-2.5 flex list-disc flex-col gap-1 pl-5 text-sm text-text-secondary">
                  {children}
                </ul>
              ),
              li: ({ children }) => <li className="leading-relaxed">{children}</li>,
              strong: ({ children }) => (
                <strong className="font-semibold text-text-primary">{children}</strong>
              ),
              table: ({ children }) => (
                <div className="mb-2.5 overflow-x-auto">
                  <table className="w-full text-left text-xs text-text-secondary">{children}</table>
                </div>
              ),
              th: ({ children }) => (
                <th className="border-b border-border-medium py-1 pr-3 font-semibold text-text-primary">
                  {children}
                </th>
              ),
              td: ({ children }) => (
                <td className="border-b border-border-light py-1 pr-3">{children}</td>
              ),
              a: ({ href, children }) => {
                if (href?.startsWith('#brain:')) {
                  const target = decodeURIComponent(href.slice('#brain:'.length));
                  return (
                    <button
                      type="button"
                      onClick={() => onNavigate(target)}
                      className="font-medium text-text-primary underline decoration-border-heavy underline-offset-2 hover:decoration-current"
                    >
                      {children}
                    </button>
                  );
                }
                return (
                  <a href={href} target="_blank" rel="noreferrer" className="underline">
                    {children}
                  </a>
                );
              },
            }}
          >
            {markdown}
          </ReactMarkdown>
        )}
      </div>
    </aside>
  );
}

export default function BrainExplorer() {
  const localize = useLocalize();
  const [query, setQuery] = useState('');
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const { data: graph, isLoading } = useBrainGraphQuery();
  const { nodes, links } = useGraphLayout(graph);

  const neighbors = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const link of links) {
      if (!map.has(link.source.id)) {
        map.set(link.source.id, new Set());
      }
      if (!map.has(link.target.id)) {
        map.set(link.target.id, new Set());
      }
      map.get(link.source.id)?.add(link.target.id);
      map.get(link.target.id)?.add(link.source.id);
    }
    return map;
  }, [links]);

  const focus = hovered ?? selected;
  const matchesQuery = useCallback(
    (id: string) => query.length > 0 && id.toLowerCase().includes(query.toLowerCase()),
    [query],
  );

  const isDimmed = useCallback(
    (id: string) => {
      if (query.length > 0) {
        return !matchesQuery(id);
      }
      if (focus == null) {
        return false;
      }
      return id !== focus && !(neighbors.get(focus)?.has(id) ?? false);
    },
    [focus, neighbors, query, matchesQuery],
  );

  const typeEntries = Object.entries(graph?.stats.types ?? {}).sort((a, b) => b[1] - a[1]);

  return (
    <section
      aria-label={localize('com_ui_company_brain')}
      className="overflow-hidden rounded-2xl border border-border-light bg-surface-primary shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-light px-5 py-4">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-base font-semibold text-text-primary">
            {localize('com_ui_brain_title', { 0: 'Anduril' })}
          </h2>
          <p className="text-xs text-text-tertiary">
            {localize('com_ui_brain_subtitle', {
              0: String(graph?.stats.notes ?? 0),
              1: String(graph?.stats.links ?? 0),
              2: String(graph?.stats.words ?? 0),
            })}
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-border-light bg-surface-secondary px-2.5 py-1.5">
          <Search className="h-3.5 w-3.5 text-text-tertiary" aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={localize('com_ui_brain_search')}
            aria-label={localize('com_ui_brain_search')}
            className="w-40 bg-transparent text-sm text-text-primary placeholder-text-tertiary outline-none"
          />
        </div>
      </div>

      <div className="flex flex-col lg:h-[620px] lg:flex-row">
        <div className="relative min-h-[420px] flex-1">
          {isLoading ? (
            <div className="flex h-full items-center justify-center text-sm text-text-tertiary">
              {localize('com_ui_loading')}
            </div>
          ) : (
            <svg
              viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
              className="h-full w-full"
              role="img"
              aria-label={localize('com_ui_company_brain')}
            >
              {links.map((link, index) => {
                const active =
                  focus != null && (link.source.id === focus || link.target.id === focus);
                const restingOpacity = focus != null || query ? 0.06 : 0.16;
                return (
                  <line
                    key={index}
                    x1={link.source.x}
                    y1={link.source.y}
                    x2={link.target.x}
                    y2={link.target.y}
                    stroke="currentColor"
                    className="text-text-tertiary"
                    strokeOpacity={active ? 0.65 : restingOpacity}
                    strokeWidth={active ? 1.4 : 1}
                  />
                );
              })}
              {nodes.map((node) => {
                const dimmed = isDimmed(node.id);
                const radius = nodeRadius(node.degree);
                return (
                  <g
                    key={node.id}
                    transform={`translate(${node.x}, ${node.y})`}
                    className="cursor-pointer"
                    opacity={dimmed ? 0.2 : 1}
                    onMouseEnter={() => setHovered(node.id)}
                    onMouseLeave={() => setHovered(null)}
                    onClick={() => setSelected(node.id)}
                  >
                    <circle
                      r={radius}
                      fill={typeColors[node.type] ?? fallbackColor}
                      stroke={selected === node.id ? 'currentColor' : 'none'}
                      strokeWidth={2}
                      className="text-text-primary"
                    />
                    <text
                      y={radius + 12}
                      textAnchor="middle"
                      fill="currentColor"
                      className="select-none text-text-secondary"
                      fontSize={11}
                    >
                      {node.id}
                    </text>
                  </g>
                );
              })}
            </svg>
          )}
          <div className="absolute bottom-3 left-4 flex flex-wrap items-center gap-3">
            {typeEntries.map(([type, count]) => (
              <span key={type} className="flex items-center gap-1.5 text-xs text-text-tertiary">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: typeColors[type] ?? fallbackColor }}
                />
                {type} · {count}
              </span>
            ))}
          </div>
        </div>
        {selected != null && (
          <NoteReader
            noteId={selected}
            onNavigate={setSelected}
            onClose={() => setSelected(null)}
          />
        )}
      </div>
    </section>
  );
}
