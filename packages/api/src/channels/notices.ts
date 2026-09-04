import type { ChannelNoticeLean } from '@librechat/data-schemas';

export type NoticeChannel = 'imessage' | 'photon' | 'email';

export interface NoticeMethods {
  claimChannelNotices: (
    user: string,
    options?: { limit?: number; maxAttempts?: number },
  ) => Promise<ChannelNoticeLean[]>;
  resolveChannelNotice: (
    noticeId: string,
    outcome: { delivered: boolean; via: string },
  ) => Promise<ChannelNoticeLean | null>;
}

export interface NoticeDeliveryDeps {
  methods: NoticeMethods;
  user: string;
  via: NoticeChannel;
  /** Owner-only sender supplied by the connector; must refuse any other recipient. */
  send: (text: string) => Promise<void> | void;
  logger: { info: (message: string) => void; error: (message: string, error?: unknown) => void };
}

/**
 * Delivers agent-initiated notices (budget alerts, later the morning brief) to
 * the owner over whichever connector claims them first. A failed send returns
 * the notice to pending so the next tick — or the other channel — retries it.
 */
export async function deliverChannelNotices(deps: NoticeDeliveryDeps): Promise<number> {
  const notices = await deps.methods.claimChannelNotices(deps.user);
  let delivered = 0;
  for (const notice of notices) {
    try {
      await deps.send(notice.text);
      await deps.methods.resolveChannelNotice(String(notice._id), {
        delivered: true,
        via: deps.via,
      });
      delivered += 1;
      deps.logger.info(`[${deps.via}] delivered ${notice.kind} notice`);
    } catch (error) {
      await deps.methods.resolveChannelNotice(String(notice._id), {
        delivered: false,
        via: deps.via,
      });
      deps.logger.error(`[${deps.via}] notice delivery failed`, error);
    }
  }
  return delivered;
}
