import type { ChannelStateLean } from '@librechat/data-schemas';

export type PauseCommand = 'pause' | 'resume';

export interface PauseMethods {
  isChannelsPaused: (user: string) => Promise<boolean>;
  setChannelsPaused: (user: string, paused: boolean, via: string) => Promise<ChannelStateLean>;
}

const PAUSE_PHRASES = new Set(['pause everything', 'pause', 'silkroad pause']);
const RESUME_PHRASES = new Set(['resume', 'resume everything', 'unpause', 'silkroad resume']);

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/^silkroad[:,]\s*/, 'silkroad ')
    .replace(/[.!?,\s]+$/g, '')
    .trim();
}

/** Recognises the owner's kill-switch phrases (brief §6). Exact phrases only. */
export function parsePauseCommand(text: string): PauseCommand | null {
  const normalized = normalize(text);
  if (PAUSE_PHRASES.has(normalized)) {
    return 'pause';
  }
  if (RESUME_PHRASES.has(normalized)) {
    return 'resume';
  }
  return null;
}

export const PAUSE_ACK =
  'Paused. I will keep logging but send nothing and write nothing until you say "resume".';
export const RESUME_ACK = 'Resumed.';

/**
 * Applies a pause/resume command from an owner-authored message. Returns the
 * acknowledgement to send back, or null when the text was not a command.
 */
export async function handlePauseCommand(
  methods: Pick<PauseMethods, 'setChannelsPaused'>,
  user: string,
  text: string,
  via: string,
): Promise<string | null> {
  const command = parsePauseCommand(text);
  if (command == null) {
    return null;
  }
  await methods.setChannelsPaused(user, command === 'pause', via);
  return command === 'pause' ? PAUSE_ACK : RESUME_ACK;
}
