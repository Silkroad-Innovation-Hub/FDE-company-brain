/** One inbound text from a Photon iMessage line, already reduced to what the pipeline needs. */
export interface PhotonInbound {
  id: string;
  text: string;
  /** E.164 phone or Apple ID email of the sender, as Apple delivered it. */
  sender: string;
  spaceId: string;
  kind: 'dm' | 'group';
  /** The Photon line (phone number) this conversation runs on. */
  line: string;
  timestamp: Date;
}

export interface PhotonLogger {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string, error?: unknown) => void;
}

/**
 * Transport seam for the Photon connector. The SDK-backed implementation lives in
 * `client.ts` (the only module importing `@spectrum-ts/*`); tests use an in-memory fake.
 */
export interface PhotonClient {
  /** Inbound text messages only; the agent's own sends and non-text content never appear here. */
  messages: () => AsyncIterable<PhotonInbound>;
  /** Sends `text` to `handle` in its DM; resolves to the sent message id when the SDK reports one. */
  send: (handle: string, text: string) => Promise<string | undefined>;
  /** Runs `fn` with the typing indicator shown in `handle`'s DM. */
  respondingIn: <T>(handle: string, fn: () => Promise<T>) => Promise<T>;
  /** Shares the agent's native contact card so the recipient can save the number in one tap. */
  shareContactCard: (handle: string) => Promise<void>;
  /** Resolves the line (phone number) that `handle`'s DM runs on. */
  lineFor: (handle: string) => Promise<string>;
  stop: () => Promise<void>;
}
