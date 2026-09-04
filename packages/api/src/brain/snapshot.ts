import type { TodoLean } from '@librechat/data-schemas';
import type { BrainNoteMeta } from './vault';
import { loadVault } from './vault';
import { DASHBOARD_SNAPSHOT } from './dashboard';

/** Placeholder a model spec's promptPrefix carries to receive the live brain snapshot. */
export const BRAIN_PLACEHOLDER = '{{silkroad_brain}}';

const FACTS_PER_NOTE = 4;
const MAX_TODOS = 12;
const MAX_FACT_CHARS = 140;

export function hasBrainPlaceholder(prompt: string | null | undefined): boolean {
  return typeof prompt === 'string' && prompt.includes(BRAIN_PLACEHOLDER);
}

function noteLine(note: BrainNoteMeta): string {
  const facts = note.facts
    .slice(0, FACTS_PER_NOTE)
    .map((fact) => fact.replace(/\s+/g, ' ').trim().slice(0, MAX_FACT_CHARS))
    .filter(Boolean);
  const fields = Object.entries(note.fields ?? {})
    .filter(([key]) => key !== 'type' && key !== 'tags')
    .map(([key, value]) => `${key}: ${value}`);
  const detail = [...facts, ...fields].join('; ');
  return `- ${note.title} (${note.type})${detail ? `: ${detail}` : ''}`;
}

function todoLines(todos: TodoLean[]): string {
  const open = todos.filter((todo) => !todo.done).slice(0, MAX_TODOS);
  if (open.length === 0) {
    return "Open to-dos: the list is empty right now — derive today's priorities from the notes below; never say there are none.";
  }
  const lines = open.map((todo, index) => `${index + 1}. ${todo.text}`).join('\n');
  return `Open to-dos (owner's dashboard, priority order):\n${lines}`;
}

/**
 * The whole company brain in one compact block — open to-dos plus every vault note's
 * headline facts — so a channel answer needs no tool round-trip for the common case.
 * `loadVault` caches by vault stamp, so this is cheap to call per request.
 */
export async function buildBrainSnapshot(
  vaultPath: string,
  todos: TodoLean[],
  inbox?: string,
): Promise<string> {
  const notes = await loadVault(vaultPath);
  const sorted = [...notes].sort((a, b) => a.title.localeCompare(b.title));
  return [
    todoLines(todos),
    ...(inbox ? [inbox] : []),
    DASHBOARD_SNAPSHOT,
    `Company brain (${notes.length} notes; title (type): key facts):`,
    ...sorted.map(noteLine),
  ].join('\n');
}

/** Replaces the placeholder in a promptPrefix; leaves prompts without it untouched. */
export function injectBrainSnapshot(prompt: string, snapshot: string): string {
  return prompt.split(BRAIN_PLACEHOLDER).join(snapshot);
}
