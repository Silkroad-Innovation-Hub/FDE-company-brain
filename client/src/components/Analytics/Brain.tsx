import { useMemo, useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { X, Search } from 'lucide-react';
import { forceLink, forceManyBody, forceCollide, forceCenter, forceSimulation } from 'd3-force';
import type { SimulationNodeDatum, SimulationLinkDatum } from 'd3-force';
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
  company: '#BCA370',
  product: '#7C8DA6',
  program: '#8A9B8E',
  finance: '#B8869B',
  person: '#BC8A70',
  facility: '#70A3BC',
  org: '#978EBC',
  intel: '#8F8F73',
};

const fallbackColor = '#8A8A8A';

const satelliteTypes = new Set(['topic', 'fact', 'tag']);

const NOTE_RADIUS_MIN = 5.5;
const NOTE_RADIUS_MAX = 19;
const SATELLITE_RADIUS = 2.6;
const HUB_COUNT = 4;

interface LayoutNode extends SimulationNodeDatum {
  id: string;
  type: string;
  degree: number;
  label?: string;
  parent?: string;
  radius: number;
  satellite: boolean;
  hub: boolean;
}

interface LayoutLink extends SimulationLinkDatum<LayoutNode> {
  source: LayoutNode;
  target: LayoutNode;
}

/** Deterministic per-node jitter so satellite orbits vary without Math.random. */
function hash01(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return (hash >>> 0) / 4294967295;
}

const FIT_PADDING_X = 76;
const FIT_PADDING_Y = 44;

/**
 * Force layouts settle into a blob much smaller than the canvas; stretch the
 * settled coordinates so the graph always fills the viewBox edge to edge.
 */
function fitToBounds(nodes: LayoutNode[]): void {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.x ?? 0);
    maxX = Math.max(maxX, node.x ?? 0);
    minY = Math.min(minY, node.y ?? 0);
    maxY = Math.max(maxY, node.y ?? 0);
  }
  const scaleX = (GRAPH_WIDTH - FIT_PADDING_X * 2) / Math.max(maxX - minX, 1);
  const scaleY = (GRAPH_HEIGHT - FIT_PADDING_Y * 2) / Math.max(maxY - minY, 1);
  for (const node of nodes) {
    node.x = FIT_PADDING_X + ((node.x ?? 0) - minX) * scaleX;
    node.y = FIT_PADDING_Y + ((node.y ?? 0) - minY) * scaleY;
  }
}

function noteRadiusScale(noteDegrees: number[]): (degree: number) => number {
  let minDegree = Infinity;
  let maxDegree = -Infinity;
  for (const degree of noteDegrees) {
    minDegree = Math.min(minDegree, degree);
    maxDegree = Math.max(maxDegree, degree);
  }
  const span = Math.max(maxDegree - minDegree, 1);
  return (degree) =>
    NOTE_RADIUS_MIN + (NOTE_RADIUS_MAX - NOTE_RADIUS_MIN) * Math.sqrt((degree - minDegree) / span);
}

function useGraphLayout(graph?: TBrainGraph) {
  return useMemo(() => {
    if (!graph) {
      return { nodes: [] as LayoutNode[], links: [] as LayoutLink[] };
    }
    const noteDegrees: number[] = [];
    for (const node of graph.nodes) {
      if (!satelliteTypes.has(node.type)) {
        noteDegrees.push(node.degree);
      }
    }
    const radiusFor = noteRadiusScale(noteDegrees);
    const hubThreshold = [...noteDegrees].sort((a, b) => b - a)[
      Math.min(HUB_COUNT, noteDegrees.length) - 1
    ];

    const nodes: LayoutNode[] = graph.nodes.map((node) => {
      const satellite = satelliteTypes.has(node.type);
      return {
        ...node,
        satellite,
        radius: satellite ? SATELLITE_RADIUS : radiusFor(node.degree),
        hub: !satellite && node.degree >= hubThreshold,
      };
    });
    const links = graph.links.map((link) => ({ ...link })) as unknown as LayoutLink[];

    const isNotePair = (link: LayoutLink) => !link.source.satellite && !link.target.satellite;
    const simulation = forceSimulation(nodes)
      .force(
        'link',
        forceLink<LayoutNode, LayoutLink>(links)
          .id((node) => node.id)
          .distance((link) =>
            isNotePair(link) ? 150 : 26 + 46 * hash01(link.target.id + link.source.id),
          )
          .strength((link) => (isNotePair(link) ? 0.02 : 0.85)),
      )
      .force(
        'charge',
        forceManyBody<LayoutNode>().strength((node) => (node.satellite ? -26 : -480)),
      )
      .force('center', forceCenter(GRAPH_WIDTH / 2, GRAPH_HEIGHT / 2))
      .force(
        'collide',
        forceCollide<LayoutNode>().radius((node) =>
          node.satellite ? node.radius + 3 : Math.max(node.radius + 12, node.id.length * 2.6),
        ),
      )
      .stop();
    simulation.tick(300);
    fitToBounds(nodes);
    return { nodes, links };
  }, [graph]);
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
    (node: LayoutNode) =>
      query.length > 0 && (node.label ?? node.id).toLowerCase().includes(query.toLowerCase()),
    [query],
  );

  const isDimmed = useCallback(
    (node: LayoutNode) => {
      if (query.length > 0) {
        return !matchesQuery(node);
      }
      if (focus == null) {
        return false;
      }
      return node.id !== focus && !(neighbors.get(focus)?.has(node.id) ?? false);
    },
    [focus, neighbors, query, matchesQuery],
  );

  const showsSatelliteLabel = useCallback(
    (node: LayoutNode) => {
      if (matchesQuery(node)) {
        return true;
      }
      if (focus == null) {
        return false;
      }
      return node.id === focus || (neighbors.get(focus)?.has(node.id) ?? false);
    },
    [focus, neighbors, matchesQuery],
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
                const starburst = link.source.satellite || link.target.satellite;
                const quiet = focus != null || query.length > 0;
                let restingOpacity = starburst ? 0.22 : 0.06;
                if (quiet) {
                  restingOpacity = 0.03;
                }
                const restingWidth = starburst ? 0.7 : 0.9;
                return (
                  <line
                    key={index}
                    x1={link.source.x}
                    y1={link.source.y}
                    x2={link.target.x}
                    y2={link.target.y}
                    stroke="currentColor"
                    className="text-text-tertiary"
                    strokeOpacity={active ? 0.7 : restingOpacity}
                    strokeWidth={active ? 1.4 : restingWidth}
                  />
                );
              })}
              {nodes.map((node) => {
                const dimmed = isDimmed(node);
                const targetNote = node.satellite ? node.parent : node.id;
                return (
                  <g
                    key={node.id}
                    transform={`translate(${node.x}, ${node.y})`}
                    className={targetNote != null ? 'cursor-pointer' : undefined}
                    opacity={dimmed ? 0.15 : 1}
                    onMouseEnter={() => setHovered(node.id)}
                    onMouseLeave={() => setHovered(null)}
                    onClick={() => targetNote != null && setSelected(targetNote)}
                  >
                    <circle r={Math.max(node.radius, 8)} fill="transparent" />
                    {node.hub && (
                      <circle
                        r={node.radius + 6}
                        fill={typeColors[node.type] ?? fallbackColor}
                        opacity={0.15}
                      />
                    )}
                    {node.satellite ? (
                      <circle
                        r={node.radius}
                        fill="currentColor"
                        className="text-text-tertiary"
                        fillOpacity={0.75}
                      />
                    ) : (
                      <circle
                        r={node.radius}
                        fill={typeColors[node.type] ?? fallbackColor}
                        stroke={selected === node.id ? 'currentColor' : 'none'}
                        strokeWidth={1.5}
                        className="text-text-primary"
                      />
                    )}
                  </g>
                );
              })}
              {nodes.map((node) => {
                if (node.satellite && !showsSatelliteLabel(node)) {
                  return null;
                }
                const scale = (node.radius - NOTE_RADIUS_MIN) / (NOTE_RADIUS_MAX - NOTE_RADIUS_MIN);
                const restingLabelOpacity = node.satellite ? 0.85 : 1;
                return (
                  <text
                    key={node.id}
                    x={node.x}
                    y={(node.y ?? 0) + node.radius + (node.satellite ? 8 : 11)}
                    textAnchor="middle"
                    fill="currentColor"
                    opacity={isDimmed(node) ? 0.15 : restingLabelOpacity}
                    className={
                      node.satellite
                        ? 'pointer-events-none select-none text-text-tertiary'
                        : 'pointer-events-none select-none text-text-secondary'
                    }
                    fontSize={node.satellite ? 7.5 : 8.5 + 4 * scale}
                    fontWeight={node.hub ? 600 : 400}
                    style={{
                      paintOrder: 'stroke',
                      stroke: 'var(--surface-primary, #171717)',
                      strokeWidth: 3,
                      strokeLinejoin: 'round',
                    }}
                  >
                    {node.label ?? node.id}
                  </text>
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
