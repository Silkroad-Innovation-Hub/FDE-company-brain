import { Spectrum } from '@spectrum-ts/core';
import { imessage, nativeContactCard } from '@spectrum-ts/imessage';
import type { Space } from '@spectrum-ts/core';
import type { PhotonClient, PhotonInbound, PhotonLogger } from './types';

export interface PhotonClientConfig {
  projectId: string;
  projectSecret: string;
  logger: PhotonLogger;
}

function normalizeHandle(handle: string): string {
  return handle.trim().toLowerCase();
}

/**
 * Photon Spectrum-backed transport: one gRPC stream in, DM sends out. This is the
 * only module that touches `@spectrum-ts/*`; everything else programs against
 * `PhotonClient` so the pipeline stays testable without the SDK.
 */
export async function createPhotonClient(config: PhotonClientConfig): Promise<PhotonClient> {
  const app = await Spectrum({
    projectId: config.projectId,
    projectSecret: config.projectSecret,
    providers: [imessage.config()],
  });
  const im = imessage(app);
  const spaces = new Map<string, Space>();

  const spaceFor = async (handle: string): Promise<Space> => {
    const key = normalizeHandle(handle);
    const cached = spaces.get(key);
    if (cached) {
      return cached;
    }
    const user = await im.user(handle);
    const space = await im.space.create(user);
    spaces.set(key, space);
    return space;
  };

  async function* messages(): AsyncIterable<PhotonInbound> {
    for await (const [space, message] of app.messages) {
      if (!imessage.is(message) || !imessage.is(space)) {
        continue;
      }
      if (message.direction === 'outbound' || message.content.type !== 'text') {
        continue;
      }
      const sender = message.sender?.id;
      if (!sender) {
        config.logger.warn(`[photon] message ${message.id} has no sender; skipped`);
        continue;
      }
      yield {
        id: message.id,
        text: message.content.text,
        sender,
        spaceId: space.id,
        kind: space.type,
        line: space.phone,
        timestamp: message.timestamp,
      };
    }
  }

  return {
    messages,
    send: async (handle, text) => {
      const space = await spaceFor(handle);
      const sent = await space.send(text);
      return sent?.id;
    },
    respondingIn: async (handle, fn) => {
      const space = await spaceFor(handle);
      return space.responding(fn);
    },
    shareContactCard: async (handle) => {
      const space = await spaceFor(handle);
      await space.send(nativeContactCard());
    },
    lineFor: async (handle) => imessage(await spaceFor(handle)).phone,
    stop: () => app.stop(),
  };
}
