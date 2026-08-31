export type GatewaySurface = 'imessage' | 'email';

export interface GatewayAnswerRequest {
  surface: GatewaySurface;
  externalThreadId: string;
  question: string;
  sender?: string;
  subject?: string;
  format?: 'plain' | 'markdown';
}

export interface GatewayAnswer {
  text: string;
  conversationId: string;
  messageId: string;
  truncated: boolean;
}

export type GatewayFailureKind = 'paused' | 'budget' | 'unauthorized' | 'unavailable' | 'error';

export class GatewayError extends Error {
  readonly kind: GatewayFailureKind;
  readonly status?: number;

  constructor(kind: GatewayFailureKind, message: string, status?: number) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

export interface GatewayClientConfig {
  url: string;
  token: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export interface GatewayClient {
  answer: (request: GatewayAnswerRequest) => Promise<GatewayAnswer>;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const ANSWER_PATH = '/api/channels/answer';

function kindForStatus(status: number): GatewayFailureKind {
  if (status === 423) {
    return 'paused';
  }
  if (status === 429) {
    return 'budget';
  }
  if (status === 401 || status === 403) {
    return 'unauthorized';
  }
  return 'error';
}

/**
 * Connector-side client for the channel gateway. Connectors hold this token and
 * nothing else — no model keys — so a compromised Mac can at most ask the
 * owner's own agent questions.
 */
export function createGatewayClient(config: GatewayClientConfig): GatewayClient {
  const fetchFn = config.fetchFn ?? fetch;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const endpoint = `${config.url.replace(/\/+$/, '')}${ANSWER_PATH}`;

  async function answer(request: GatewayAnswerRequest): Promise<GatewayAnswer> {
    let response: Response;
    try {
      response = await fetchFn(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.token}`,
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new GatewayError('unavailable', `gateway unreachable at ${endpoint}: ${message}`);
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new GatewayError(
        kindForStatus(response.status),
        `gateway responded ${response.status}: ${body.slice(0, 200)}`,
        response.status,
      );
    }
    return (await response.json()) as GatewayAnswer;
  }

  return { answer };
}
