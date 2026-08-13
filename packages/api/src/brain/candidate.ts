export interface BrainCandidateMessage {
  messageId?: string;
  newMessageId?: string;
  conversationId?: string;
  text?: string;
  content?: Array<{ type?: string; text?: string | { value?: string } }>;
  isCreatedByUser?: boolean;
  unfinished?: boolean;
  error?: boolean;
}

export interface BrainCandidate {
  surface: 'chat';
  direction: 'inbound' | 'outbound';
  conversationId?: string;
  messageId: string;
  text: string;
}

const MIN_TEXT_LENGTH = 2;

function extractText(message: BrainCandidateMessage): string {
  if (typeof message.text === 'string' && message.text.trim().length > 0) {
    return message.text.trim();
  }
  if (!Array.isArray(message.content)) {
    return '';
  }
  return message.content
    .map((part) => {
      if (part.type !== 'text') {
        return '';
      }
      return typeof part.text === 'string' ? part.text : (part.text?.value ?? '');
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

/**
 * Maps a saved chat message to a raw-log candidate, or null when the message
 * should never enter the log (empty, errored, or still streaming).
 */
export function toBrainCandidate(
  message: BrainCandidateMessage,
  isTemporary?: boolean,
): BrainCandidate | null {
  if (isTemporary === true || message.error === true || message.unfinished === true) {
    return null;
  }
  const messageId = message.newMessageId || message.messageId;
  if (!messageId) {
    return null;
  }
  const text = extractText(message);
  if (text.length < MIN_TEXT_LENGTH) {
    return null;
  }
  return {
    surface: 'chat',
    direction: message.isCreatedByUser === true ? 'inbound' : 'outbound',
    conversationId: message.conversationId,
    messageId,
    text,
  };
}
