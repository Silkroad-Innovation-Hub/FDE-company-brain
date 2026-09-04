import type {
  BrainLogAppendData,
  ChannelNoticeLean,
  BrainLogLean,
  TodoLean,
} from '@librechat/data-schemas';
import type { ChannelIngestMethods } from './ingest';
import type { NoticeMethods } from './notices';
import type { PauseMethods } from './pause';

export interface FakeChannelMethods extends ChannelIngestMethods, PauseMethods, NoticeMethods {
  getTodos: (user: string) => Promise<TodoLean[]>;
  log: Map<string, BrainLogLean>;
  paused: boolean[];
  notices: ChannelNoticeLean[];
  addNotice: (text: string) => ChannelNoticeLean;
}

/**
 * In-memory stand-in for the connector-facing `createMethods` surface: a brain log that
 * reproduces the `createdAt === updatedAt` freshness contract, a notice queue with
 * claim/resolve semantics, and the pause flag history.
 */
export function fakeChannelMethods(): FakeChannelMethods {
  const log = new Map<string, BrainLogLean>();
  const paused: boolean[] = [];
  const notices: ChannelNoticeLean[] = [];
  return {
    log,
    paused,
    notices,
    addNotice: (text: string) => {
      const notice = {
        _id: `n${notices.length + 1}`,
        user: 'u1',
        kind: 'budget',
        text,
        status: 'pending',
        attempts: 0,
      } as unknown as ChannelNoticeLean;
      notices.push(notice);
      return notice;
    },
    claimChannelNotices: async () => {
      const pending = notices.filter((n) => n.status === 'pending');
      for (const notice of pending) {
        notice.status = 'delivering';
        notice.attempts += 1;
      }
      return pending;
    },
    resolveChannelNotice: async (id: string, outcome: { delivered: boolean; via: string }) => {
      const notice = notices.find((n) => String(n._id) === id) ?? null;
      if (notice) {
        notice.status = outcome.delivered ? 'delivered' : 'pending';
        notice.deliveredVia = outcome.delivered ? outcome.via : undefined;
      }
      return notice;
    },
    appendBrainLog: async (user: string, data: BrainLogAppendData) => {
      const existing = log.get(data.messageId);
      if (existing) {
        return { ...existing, updatedAt: new Date(Date.now() + 10) };
      }
      const now = new Date();
      const { resolution, ...rest } = data;
      const entry = {
        _id: data.messageId,
        user,
        ...rest,
        status: 'pending',
        ...(resolution ?? {}),
        createdAt: now,
        updatedAt: now,
      } as unknown as BrainLogLean;
      log.set(data.messageId, entry);
      return entry;
    },
    isChannelsPaused: async () => paused[paused.length - 1] === true,
    setChannelsPaused: async (_user: string, value: boolean) => {
      paused.push(value);
      return {} as never;
    },
    getTodos: async () =>
      [{ text: 'Chase Henderson', done: false, position: 1 }] as unknown as TodoLean[],
  };
}
