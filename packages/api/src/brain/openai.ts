export interface BrainChatMessage {
  role: 'system' | 'user';
  content: string;
}

export type BrainChatFn = (messages: BrainChatMessage[], model: string) => Promise<string>;

export interface BrainChatConfig {
  apiKey?: string;
  baseUrl?: string;
  json?: boolean;
  timeoutMs?: number;
}

/** Embeds a batch of texts; one vector per input, same order. */
export type BrainEmbedFn = (texts: string[]) => Promise<Float32Array[]>;

export interface BrainEmbedConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
}

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_TIMEOUT_MS = 60_000;
export const DEFAULT_EMBED_MODEL: string = 'text-embedding-3-small';
const EMBED_BATCH_SIZE = 64;
const EMBED_MAX_CHARS = 8_000;
const EMBED_MAX_ATTEMPTS = 3;
const EMBED_BACKOFF_MS = 500;

export class BrainChatError extends Error {}

/** Minimal tool-less chat completion — brain gate and channel responders share it. */
export function createBrainChat(config: BrainChatConfig): BrainChatFn {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return async (messages, model) => {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey ?? ''}`,
      },
      body: JSON.stringify({
        model,
        messages,
        ...(config.json === false ? {} : { response_format: { type: 'json_object' } }),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      throw new BrainChatError(`Model call failed: ${response.status} ${await response.text()}`);
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      throw new BrainChatError('Model returned no content');
    }
    return content;
  };
}

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function embedBatch(
  config: BrainEmbedConfig,
  baseUrl: string,
  model: string,
  timeoutMs: number,
  inputs: string[],
): Promise<Float32Array[]> {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(`${baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey ?? ''}`,
      },
      body: JSON.stringify({ model, input: inputs }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.ok) {
      const payload = (await response.json()) as {
        data?: Array<{ index: number; embedding: number[] }>;
      };
      const rows = payload.data ?? [];
      if (rows.length !== inputs.length) {
        throw new BrainChatError(
          `Embeddings returned ${rows.length} vectors for ${inputs.length} inputs`,
        );
      }
      return rows
        .slice()
        .sort((a, b) => a.index - b.index)
        .map((row) => Float32Array.from(row.embedding));
    }
    const body = await response.text();
    if (!isRetryable(response.status) || attempt >= EMBED_MAX_ATTEMPTS) {
      throw new BrainChatError(`Embeddings call failed: ${response.status} ${body}`);
    }
    await sleep(EMBED_BACKOFF_MS * 2 ** (attempt - 1));
  }
}

/** Batched embeddings call over the OpenAI-compatible `/embeddings` endpoint. */
export function createBrainEmbed(config: BrainEmbedConfig): BrainEmbedFn {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const model = config.model ?? DEFAULT_EMBED_MODEL;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return async (texts) => {
    if (texts.length === 0) {
      return [];
    }
    const inputs = texts.map((text) => text.slice(0, EMBED_MAX_CHARS) || ' ');
    const vectors: Float32Array[] = [];
    for (let start = 0; start < inputs.length; start += EMBED_BATCH_SIZE) {
      const batch = inputs.slice(start, start + EMBED_BATCH_SIZE);
      vectors.push(...(await embedBatch(config, baseUrl, model, timeoutMs, batch)));
    }
    return vectors;
  };
}
