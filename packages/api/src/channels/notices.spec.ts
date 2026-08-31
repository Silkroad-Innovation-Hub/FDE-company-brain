import type { ChannelNoticeLean } from '@librechat/data-schemas';
import { deliverChannelNotices } from './notices';

function store(texts: string[]) {
  const notices = texts.map(
    (text, i) =>
      ({
        _id: `n${i}`,
        user: 'u1',
        kind: 'budget',
        text,
        status: 'pending',
        attempts: 0,
      }) as unknown as ChannelNoticeLean,
  );
  const methods = {
    claimChannelNotices: jest.fn(async () => {
      const pending = notices.filter((n) => n.status === 'pending');
      for (const notice of pending) {
        notice.status = 'delivering';
      }
      return pending;
    }),
    resolveChannelNotice: jest.fn(
      async (id: string, outcome: { delivered: boolean; via: string }) => {
        const notice = notices.find((n) => String(n._id) === id) ?? null;
        if (notice) {
          notice.status = outcome.delivered ? 'delivered' : 'pending';
        }
        return notice;
      },
    ),
  };
  return { notices, methods };
}

describe('deliverChannelNotices', () => {
  const logger = { info: jest.fn(), error: jest.fn() };

  it('sends every claimed notice through the owner-only sender and marks it delivered', async () => {
    const { notices, methods } = store(['first', 'second']);
    const send = jest.fn();
    const count = await deliverChannelNotices({
      methods,
      user: 'u1',
      via: 'imessage',
      send,
      logger,
    });
    expect(count).toBe(2);
    expect(send.mock.calls.map((c) => c[0])).toEqual(['first', 'second']);
    expect(notices.every((n) => n.status === 'delivered')).toBe(true);
    expect(methods.resolveChannelNotice).toHaveBeenCalledWith('n0', {
      delivered: true,
      via: 'imessage',
    });
  });

  it('returns a failed notice to pending and keeps going', async () => {
    const { notices, methods } = store(['ok', 'boom', 'ok again']);
    const send = jest.fn(async (text: string) => {
      if (text === 'boom') {
        throw new Error('refused');
      }
    });
    const count = await deliverChannelNotices({ methods, user: 'u1', via: 'email', send, logger });
    expect(count).toBe(2);
    expect(notices.map((n) => n.status)).toEqual(['delivered', 'pending', 'delivered']);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});
