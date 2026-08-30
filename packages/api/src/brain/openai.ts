export interface BrainChatMessage {
  role: 'system' | 'user';
  content: string;
}

export type BrainChatFn = (messages: BrainChatMessage[], model: string) => Promise<string>;

export interface BrainChatConfig {
  apiKey?: string;
  baseUrl?: string;
  json?: boolean;
}

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

export class BrainChatError extends Error {}

/** Minimal tool-less chat completion — brain gate and channel responders share it. */
export function createBrainChat(config: BrainChatConfig): BrainChatFn {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
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
