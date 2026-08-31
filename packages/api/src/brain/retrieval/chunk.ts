import { createHash } from 'crypto';
import type { BrainLogLean } from '@librechat/data-schemas';
import type { BrainNote } from '~/brain/vault';

export interface BrainChunk {
  chunk: number;
  title: string;
  text: string;
  hash: string;
}

const MAX_WHOLE_NOTE_CHARS = 6_000;
const MAX_CHUNK_CHARS = 6_000;
const MAX_LOG_CHARS = 2_000;
const SECTION_BOUNDARY = /\n(?=## )/;

export function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function hardSplit(text: string): string[] {
  if (text.length <= MAX_CHUNK_CHARS) {
    return [text];
  }
  const pieces: string[] = [];
  let rest = text;
  while (rest.length > MAX_CHUNK_CHARS) {
    const cut = rest.lastIndexOf('\n', MAX_CHUNK_CHARS);
    const at = cut > MAX_CHUNK_CHARS / 2 ? cut : MAX_CHUNK_CHARS;
    pieces.push(rest.slice(0, at));
    rest = rest.slice(at);
  }
  if (rest.trim()) {
    pieces.push(rest);
  }
  return pieces;
}

function toChunk(title: string, text: string, chunk: number): BrainChunk {
  const body = `# ${title}\n${text.trim()}`;
  return { chunk, title, text: body, hash: hashText(body) };
}

/** Whole note when short; otherwise one chunk per `##` section, each prefixed with the title. */
export function noteChunks(note: BrainNote): BrainChunk[] {
  const content = note.content.trim();
  if (content.length === 0) {
    return [];
  }
  if (content.length <= MAX_WHOLE_NOTE_CHARS) {
    return [toChunk(note.title, content, 0)];
  }
  const sections = content
    .split(SECTION_BOUNDARY)
    .map((section) => section.trim())
    .filter(Boolean)
    .flatMap(hardSplit);
  return sections.map((section, index) => toChunk(note.title, section, index));
}

function logTitle(entry: BrainLogLean): string {
  const who = entry.sender ? `from ${entry.sender}` : 'from the owner';
  return entry.subject ? `${entry.surface} ${who} — ${entry.subject}` : `${entry.surface} ${who}`;
}

/** One chunk per raw-log entry: provenance line plus the (capped) text. */
export function logChunk(entry: BrainLogLean): BrainChunk {
  const title = logTitle(entry);
  const text = `${title}\n${entry.text.trim().slice(0, MAX_LOG_CHARS)}`;
  return { chunk: 0, title, text, hash: hashText(text) };
}
