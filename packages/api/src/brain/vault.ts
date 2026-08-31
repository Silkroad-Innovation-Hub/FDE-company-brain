import { promises as fs } from 'fs';
import path from 'path';

export interface BrainNoteMeta {
  id: string;
  title: string;
  type: string;
  tags: string[];
  /** Every simple `key: value` frontmatter line, raw string values (e.g. invoice amount/due). */
  fields?: Record<string, string>;
  links: string[];
  sections: string[];
  facts: string[];
  size: number;
}

export interface BrainGraphNode {
  id: string;
  type: string;
  degree: number;
  label?: string;
  parent?: string;
}

export interface BrainGraphLink {
  source: string;
  target: string;
}

export interface BrainGraph {
  nodes: BrainGraphNode[];
  links: BrainGraphLink[];
  stats: {
    notes: number;
    links: number;
    words: number;
    types: Record<string, number>;
  };
}

export interface BrainNote {
  id: string;
  title: string;
  type: string;
  tags: string[];
  fields?: Record<string, string>;
  content: string;
}

const WIKILINK_PATTERN = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
const FRONTMATTER_PATTERN = /^---\n([\s\S]*?)\n---\n?/;
const HEADING_PATTERN = /^##\s+(.+?)\s*$/gm;
const BOLD_PATTERN = /\*\*([^*\n]+)\*\*/g;
const FACT_LABEL_LIMIT = 42;

interface Frontmatter {
  type: string;
  tags: string[];
  fields: Record<string, string>;
}

const FIELD_PATTERN = /^([A-Za-z][\w-]*):\s*(.*?)\s*$/;

function parseFields(frontmatter: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of frontmatter.split('\n')) {
    const match = line.match(FIELD_PATTERN);
    if (match) {
      fields[match[1]] = match[2].replace(/^['"](.*)['"]$/, '$1');
    }
  }
  return fields;
}

function parseFrontmatter(content: string): { meta: Frontmatter; body: string } {
  const match = content.match(FRONTMATTER_PATTERN);
  if (!match) {
    return { meta: { type: 'note', tags: [], fields: {} }, body: content };
  }
  const typeMatch = match[1].match(/^type:\s*(\S+)/m);
  const tagsMatch = match[1].match(/^tags:\s*\[([^\]]*)\]/m);
  const tags = tagsMatch
    ? tagsMatch[1]
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean)
    : [];
  return {
    meta: { type: typeMatch ? typeMatch[1] : 'note', tags, fields: parseFields(match[1]) },
    body: content.slice(match[0].length),
  };
}

function extractWikilinks(body: string): string[] {
  const links = new Set<string>();
  for (const match of body.matchAll(WIKILINK_PATTERN)) {
    const target = match[1].trim();
    if (target) {
      links.add(target);
    }
  }
  return [...links];
}

function stripWikilinks(text: string): string {
  return text.replace(WIKILINK_PATTERN, (_match, target: string) => target.trim());
}

function extractSections(body: string): string[] {
  const sections = new Set<string>();
  for (const match of body.matchAll(HEADING_PATTERN)) {
    const heading = stripWikilinks(match[1]).trim();
    if (heading) {
      sections.add(heading);
    }
  }
  return [...sections];
}

function extractFacts(body: string): string[] {
  const facts = new Set<string>();
  for (const match of body.matchAll(BOLD_PATTERN)) {
    const fact = stripWikilinks(match[1]).trim();
    if (fact) {
      facts.add(fact);
    }
  }
  return [...facts];
}

function truncateLabel(label: string): string {
  return label.length > FACT_LABEL_LIMIT ? `${label.slice(0, FACT_LABEL_LIMIT - 1)}…` : label;
}

function isSafeNoteId(noteId: string): boolean {
  return (
    noteId.length > 0 &&
    noteId.length < 256 &&
    !noteId.includes('/') &&
    !noteId.includes('\\') &&
    !noteId.includes('..')
  );
}

interface VaultCacheEntry {
  stamp: string;
  notes: BrainNoteMeta[];
}

const vaultCache = new Map<string, VaultCacheEntry>();

async function listNoteFiles(vaultPath: string): Promise<string[]> {
  const entries = await fs.readdir(vaultPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name);
}

/**
 * Cheap change detector for a vault: file count plus the newest mtime. One
 * `stat` per note, no content reads — lets callers skip re-indexing work.
 */
export async function vaultStamp(vaultPath: string): Promise<string> {
  const files = await listNoteFiles(vaultPath);
  const stats = await Promise.all(files.map((name) => fs.stat(path.join(vaultPath, name))));
  const newest = stats.reduce((max, stat) => Math.max(max, stat.mtimeMs), 0);
  const bytes = stats.reduce((sum, stat) => sum + stat.size, 0);
  return `${files.length}:${newest}:${bytes}`;
}

export function invalidateVaultCache(vaultPath?: string): void {
  if (vaultPath) {
    vaultCache.delete(vaultPath);
    return;
  }
  vaultCache.clear();
}

export async function loadVault(vaultPath: string): Promise<BrainNoteMeta[]> {
  const stamp = await vaultStamp(vaultPath);
  const cached = vaultCache.get(vaultPath);
  if (cached && cached.stamp === stamp) {
    return cached.notes;
  }
  const notes = await readVault(vaultPath);
  vaultCache.set(vaultPath, { stamp, notes });
  return notes;
}

async function readVault(vaultPath: string): Promise<BrainNoteMeta[]> {
  const names = await listNoteFiles(vaultPath);
  const files = names.map((name) => ({ name }));
  return Promise.all(
    files.map(async (file) => {
      const content = await fs.readFile(path.join(vaultPath, file.name), 'utf-8');
      const { meta, body } = parseFrontmatter(content);
      const id = file.name.replace(/\.md$/, '');
      return {
        id,
        title: id,
        type: meta.type,
        tags: meta.tags,
        fields: meta.fields,
        links: extractWikilinks(body),
        sections: extractSections(body),
        facts: extractFacts(body),
        size: body.split(/\s+/).length,
      };
    }),
  );
}

export function buildBrainGraph(notes: BrainNoteMeta[]): BrainGraph {
  const noteIds = new Set(notes.map((note) => note.id));
  const degrees = new Map<string, number>();
  const taggedNotes = new Map<string, string[]>();
  const links: BrainGraphLink[] = [];
  const types: Record<string, number> = {};
  let words = 0;

  for (const note of notes) {
    types[note.type] = (types[note.type] ?? 0) + 1;
    words += note.size;
    for (const tag of note.tags) {
      const tagged = taggedNotes.get(tag) ?? [];
      tagged.push(note.id);
      taggedNotes.set(tag, tagged);
    }
    for (const target of note.links) {
      if (!noteIds.has(target) || target === note.id) {
        continue;
      }
      links.push({ source: note.id, target });
      degrees.set(note.id, (degrees.get(note.id) ?? 0) + 1);
      degrees.set(target, (degrees.get(target) ?? 0) + 1);
    }
  }

  const noteLinkCount = links.length;
  const nodes: BrainGraphNode[] = notes.map((note) => ({
    id: note.id,
    type: note.type,
    degree: degrees.get(note.id) ?? 0,
  }));

  for (const note of notes) {
    for (const section of note.sections) {
      const id = `${note.id}#${section}`;
      nodes.push({ id, type: 'topic', degree: 1, label: section, parent: note.id });
      links.push({ source: note.id, target: id });
    }
    note.facts.forEach((fact, index) => {
      const id = `${note.id}#fact-${index}`;
      nodes.push({ id, type: 'fact', degree: 1, label: truncateLabel(fact), parent: note.id });
      links.push({ source: note.id, target: id });
    });
  }

  for (const [tag, tagged] of taggedNotes) {
    const id = `#${tag}`;
    nodes.push({ id, type: 'tag', degree: tagged.length, label: id });
    for (const noteId of tagged) {
      links.push({ source: noteId, target: id });
    }
  }

  return {
    nodes,
    links,
    stats: { notes: notes.length, links: noteLinkCount, words, types },
  };
}

export interface BrainNoteWrite {
  id: string;
  type: string;
  tags?: string[];
  content: string;
}

export async function writeBrainNote(vaultPath: string, note: BrainNoteWrite): Promise<boolean> {
  if (!isSafeNoteId(note.id)) {
    return false;
  }
  const tags = (note.tags ?? []).join(', ');
  const frontmatter = `---\ntype: ${note.type}\ntags: [${tags}]\n---\n\n`;
  const body = note.content.replace(FRONTMATTER_PATTERN, '');
  await fs.writeFile(path.join(vaultPath, `${note.id}.md`), frontmatter + body.trim() + '\n');
  invalidateVaultCache(vaultPath);
  return true;
}

export async function readBrainNote(vaultPath: string, noteId: string): Promise<BrainNote | null> {
  if (!isSafeNoteId(noteId)) {
    return null;
  }
  let content: string;
  try {
    content = await fs.readFile(path.join(vaultPath, `${noteId}.md`), 'utf-8');
  } catch {
    return null;
  }
  const { meta, body } = parseFrontmatter(content);
  return {
    id: noteId,
    title: noteId,
    type: meta.type,
    tags: meta.tags,
    fields: meta.fields,
    content: body,
  };
}
