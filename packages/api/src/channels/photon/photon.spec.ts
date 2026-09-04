import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { PhotonClient, PhotonInbound } from './types';
import type { PhotonDeps } from './stream';
import { fakeChannelMethods } from '~/channels/methods.helper';
import { ThreadMemory } from '~/channels/memory';
import { GatewayError } from '~/channels/remote';
import {
  deliverPhotonNotices,
  normalizePhotonHandle,
  processPhotonMessage,
  startPhotonConnector,
  ownerOnlySender,
} from './stream';

const OWNER = '+15550001111';
const STRANGER = '+15559998888';
const LINE = '+18885550100';
const SPACE = `any;-;${OWNER}`;

interface FakeClient extends PhotonClient {
  sent: Array<[string, string]>;
  typing: string[];
  push: (message: PhotonInbound) => void;
  end: () => void;
  stopped: boolean;
}

function fakeClient(): FakeClient {
  const queue: PhotonInbound[] = [];
  let ended = false;
  let wake: (() => void) | null = null;
  const notify = () => {
    wake?.();
    wake = null;
  };
  const sent: Array<[string, string]> = [];
  const typing: string[] = [];
  let counter = 0;
  const client: FakeClient = {
    sent,
    typing,
    stopped: false,
    push: (message) => {
      queue.push(message);
      notify();
    },
    end: () => {
      ended = true;
      notify();
    },
    messages: async function* () {
      for (;;) {
        if (queue.length > 0) {
          yield queue.shift() as PhotonInbound;
          continue;
        }
        if (ended) {
          return;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    },
    send: async (handle, text) => {
      sent.push([handle, text]);
      counter += 1;
      return `s${counter}`;
    },
    respondingIn: async (handle, fn) => {
      typing.push(handle);
      return fn();
    },
    shareContactCard: async () => undefined,
    lineFor: async () => LINE,
    stop: async () => {
      client.stopped = true;
    },
  };
  return client;
}

function inbound(overrides: Partial<PhotonInbound>): PhotonInbound {
  return {
    id: 'm1',
    text: 'what do I owe?',
    sender: OWNER,
    spaceId: SPACE,
    kind: 'dm',
    line: LINE,
    timestamp: new Date('2026-09-03T10:00:00Z'),
    ...overrides,
  };
}

const logger = () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() });

describe('normalizePhotonHandle', () => {
  it('compares phones and emails the way Apple delivers them', () => {
    expect(normalizePhotonHandle('+1 (555) 000-1111')).toBe('+15550001111');
    expect(normalizePhotonHandle(' Owner@Example.com ')).toBe('owner@example.com');
  });
});

describe('processPhotonMessage', () => {
  let vaultPath: string;
  let client: FakeClient;
  let deps: PhotonDeps & { methods: ReturnType<typeof fakeChannelMethods> };
  let memory: ThreadMemory;

  beforeEach(async () => {
    vaultPath = await fs.mkdtemp(path.join(os.tmpdir(), 'photon-vault-'));
    client = fakeClient();
    memory = new ThreadMemory();
    deps = {
      client,
      methods: fakeChannelMethods(),
      chat: async () => 'You owe Henderson a chase.',
      model: 'test-model',
      vaultPath,
      owner: { user: 'u1', handle: '+1 (555) 000-1111' },
      logger: logger(),
    };
  });

  afterEach(async () => {
    await fs.rm(vaultPath, { recursive: true, force: true });
  });

  it('logs the owner text, answers it, and logs the reply as outbound', async () => {
    expect(await processPhotonMessage(deps, inbound({}), memory)).toBe('answered');
    expect(deps.methods.log.get('photon-m1')).toMatchObject({
      surface: 'imessage',
      direction: 'inbound',
      sender: OWNER,
      conversationId: `photon:${SPACE}`,
      subject: `iMessage ${LINE}`,
    });
    expect(client.sent).toEqual([[OWNER, 'You owe Henderson a chase.']]);
    expect(deps.methods.log.get('photon-s1')).toMatchObject({
      direction: 'outbound',
      sender: LINE,
      conversationId: `photon:${SPACE}`,
      text: 'You owe Henderson a chase.',
    });
    expect(client.typing).toEqual([OWNER]);
    expect(memory.history(SPACE)).toEqual([
      { fromOwner: true, text: 'what do I owe?' },
      { fromOwner: false, text: 'You owe Henderson a chase.' },
    ]);
  });

  it('answers through the gateway with a photon thread id and stays silent when it is paused', async () => {
    const gateway = {
      decide: jest.fn(async () => ({ outcome: 'none' as const })),
      answer: jest.fn(async () => ({
        text: 'Gateway answer.',
        conversationId: 'c1',
        messageId: 'x1',
        truncated: false,
      })),
    };
    expect(await processPhotonMessage({ ...deps, gateway }, inbound({}), memory)).toBe('answered');
    expect(gateway.answer).toHaveBeenCalledWith({
      surface: 'imessage',
      externalThreadId: `photon:${SPACE}`,
      question: 'what do I owe?',
      sender: OWNER,
      subject: `iMessage ${LINE}`,
      format: 'plain',
    });
    expect(client.sent).toEqual([[OWNER, 'Gateway answer.']]);

    const paused = {
      decide: jest.fn(async () => ({ outcome: 'none' as const })),
      answer: jest.fn(async () => {
        throw new GatewayError('paused', 'paused', 423);
      }),
    };
    expect(
      await processPhotonMessage({ ...deps, gateway: paused }, inbound({ id: 'm2' }), memory),
    ).toBe('paused');
    expect(client.sent).toHaveLength(1);
  });

  it('drops strangers and group chats before the log', async () => {
    expect(await processPhotonMessage(deps, inbound({ id: 's1', sender: STRANGER }), memory)).toBe(
      'stranger',
    );
    expect(
      await processPhotonMessage(deps, inbound({ id: 'g1', kind: 'group', spaceId: 'g' }), memory),
    ).toBe('group');
    expect(deps.methods.log.size).toBe(0);
    expect(client.sent).toEqual([]);
    expect(deps.logger.warn).toHaveBeenCalledWith(expect.stringContaining(STRANGER));
  });

  it('does not re-answer a message it has already logged', async () => {
    expect(await processPhotonMessage(deps, inbound({}), memory)).toBe('answered');
    expect(await processPhotonMessage(deps, inbound({}), memory)).toBe('duplicate');
    expect(client.sent).toHaveLength(1);
  });

  it('honours the kill switch: pause acks, paused questions go unanswered, resume restores', async () => {
    expect(
      await processPhotonMessage(deps, inbound({ id: 'p1', text: 'pause everything' }), memory),
    ).toBe('acknowledged');
    expect(deps.methods.paused).toEqual([true]);
    expect(client.sent[0][1]).toContain('Paused');
    expect(deps.methods.log.get('photon-s1')?.direction).toBe('outbound');

    expect(await processPhotonMessage(deps, inbound({ id: 'p2' }), memory)).toBe('paused');
    expect(client.sent).toHaveLength(1);

    expect(await processPhotonMessage(deps, inbound({ id: 'p3', text: 'resume' }), memory)).toBe(
      'acknowledged',
    );
    expect(await processPhotonMessage(deps, inbound({ id: 'p4' }), memory)).toBe('answered');
    expect(client.sent).toHaveLength(3);
  });

  it('labels the shared pool line as the Photon line', async () => {
    await processPhotonMessage(deps, inbound({ line: 'shared' }), memory);
    expect(deps.methods.log.get('photon-m1')?.subject).toBe('iMessage Photon line');
    expect(deps.methods.log.get('photon-s1')?.sender).toBe('Photon line');
  });

  it('treats "send" and "scrap it" as decisions on the latest draft', async () => {
    const gateway = {
      answer: jest.fn(async () => ({
        text: 'x',
        conversationId: 'c',
        messageId: 'm',
        truncated: false,
      })),
      decide: jest.fn(async (decision: 'approved' | 'denied') =>
        decision === 'approved'
          ? { outcome: 'sent' as const, to: 'dana@henderson.com', subject: 'Invoice 1042' }
          : { outcome: 'deleted' as const },
      ),
    };
    const d = { ...deps, gateway };
    expect(await processPhotonMessage(d, inbound({ id: 'd1', text: 'Send it!' }), memory)).toBe(
      'decided',
    );
    expect(gateway.decide).toHaveBeenCalledWith('approved');
    expect(client.sent[0][1]).toBe('Sent to dana@henderson.com — "Invoice 1042".');
    expect(await processPhotonMessage(d, inbound({ id: 'd2', text: 'scrap it' }), memory)).toBe(
      'decided',
    );
    expect(gateway.decide).toHaveBeenLastCalledWith('denied');
    expect(client.sent[1][1]).toMatch(/Scrapped/);
    expect(gateway.answer).not.toHaveBeenCalled();
    expect(deps.methods.log.get('photon-s1')?.direction).toBe('outbound');
  });

  it('reports a failed send without throwing', async () => {
    client.send = async () => {
      throw new Error('line down');
    };
    expect(await processPhotonMessage(deps, inbound({}), memory)).toBe('failed');
    expect(deps.logger.error).toHaveBeenCalledWith('[photon] reply failed', expect.any(Error));
  });
});

describe('ownerOnlySender', () => {
  it('refuses any recipient but the owner', async () => {
    const client = fakeClient();
    const send = ownerOnlySender('+1 555 000 1111', client);
    await expect(send(STRANGER, 'leak')).rejects.toThrow(/refused/);
    expect(await send(OWNER, 'hi')).toBe('s1');
    expect(client.sent).toEqual([[OWNER, 'hi']]);
  });
});

const until = async (condition: () => boolean): Promise<void> => {
  const deadline = Date.now() + 5_000;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error('condition not met in time');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

describe('startPhotonConnector', () => {
  it('delivers notices on the timer, answers the stream, and rejects when the stream ends', async () => {
    const client = fakeClient();
    const methods = fakeChannelMethods();
    const deps: PhotonDeps & { noticeMs: number } = {
      client,
      methods,
      chat: async () => 'answer',
      model: 'test-model',
      vaultPath: os.tmpdir(),
      owner: { user: 'u1', handle: OWNER },
      logger: logger(),
      noticeMs: 20,
    };
    const handle = startPhotonConnector(deps);
    let failure: Error | undefined;
    handle.done.catch((error: Error) => {
      failure = error;
    });

    client.push(inbound({ id: 'a1', text: 'pause everything' }));
    await until(() => client.sent.length === 1);
    expect(methods.paused).toEqual([true]);

    methods.addNotice('Spend is $131.');
    await until(() => client.sent.length === 2);
    expect(client.sent[1]).toEqual([OWNER, 'Spend is $131.']);
    expect(methods.notices[0]).toMatchObject({ status: 'delivered', deliveredVia: 'photon' });

    client.end();
    await until(() => failure != null);
    expect(failure?.message).toMatch(/stream ended/);
    await handle.stop();
    expect(client.stopped).toBe(true);
  });

  it('returns a failed notice to pending so the next tick retries it', async () => {
    const client = fakeClient();
    const methods = fakeChannelMethods();
    const deps: PhotonDeps = {
      client,
      methods,
      chat: async () => 'answer',
      model: 'test-model',
      vaultPath: os.tmpdir(),
      owner: { user: 'u1', handle: OWNER },
      logger: logger(),
    };
    const notice = methods.addNotice('second');
    const refusing = ownerOnlySender(STRANGER, client);
    expect(await deliverPhotonNotices(deps, refusing)).toBe(0);
    expect(notice.status).toBe('pending');
    expect(await deliverPhotonNotices(deps)).toBe(1);
    expect(notice.status).toBe('delivered');
  });
});
