export interface ScheduleLogger {
  info: (message: string) => void;
  error: (message: string, error?: unknown) => void;
}

export interface DailyScheduleOptions {
  hour: number;
  minute?: number;
  timeZone: string;
  run: () => Promise<void>;
  logger: ScheduleLogger;
  now?: () => Date;
}

export interface DailyScheduleHandle {
  stop: () => void;
  nextRunAt: () => Date;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const MAX_TIMEOUT_MS = 2_147_483_647;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached) {
    return cached;
  }
  const created = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  formatters.set(timeZone, created);
  return created;
}

/** Wall-clock components of an instant in a time zone. */
export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = formatter(timeZone).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour') % 24,
    minute: read('minute'),
    second: read('second'),
  };
}

/** The instant at which a time-zone wall clock reads the given components (DST-aware). */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const want = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let utc = want;
  for (let i = 0; i < 2; i++) {
    const parts = zonedParts(new Date(utc), timeZone);
    const seen = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    utc += want - seen;
  }
  return new Date(utc);
}

/** [start, end) of the calendar day containing `now` in `timeZone`. */
export function dayBounds(now: Date, timeZone: string): { start: Date; end: Date } {
  const parts = zonedParts(now, timeZone);
  return {
    start: zonedTimeToUtc(parts.year, parts.month, parts.day, 0, 0, timeZone),
    end: zonedTimeToUtc(parts.year, parts.month, parts.day + 1, 0, 0, timeZone),
  };
}

/** Next instant strictly after `now` at which the zone's wall clock reads HH:MM. */
export function nextOccurrence(now: Date, hour: number, minute: number, timeZone: string): Date {
  const parts = zonedParts(now, timeZone);
  const today = zonedTimeToUtc(parts.year, parts.month, parts.day, hour, minute, timeZone);
  if (today.getTime() > now.getTime()) {
    return today;
  }
  return zonedTimeToUtc(parts.year, parts.month, parts.day + 1, hour, minute, timeZone);
}

/**
 * Runs `run` once a day at a wall-clock time in `timeZone`. No cron library:
 * one timer to the next occurrence, re-armed after every run, with a latch so
 * a slow run can never overlap the next.
 */
export function startDailySchedule(options: DailyScheduleOptions): DailyScheduleHandle {
  const minute = options.minute ?? 0;
  const now = options.now ?? (() => new Date());
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let stopped = false;
  let next = nextOccurrence(now(), options.hour, minute, options.timeZone);

  const arm = (): void => {
    if (stopped) {
      return;
    }
    next = nextOccurrence(now(), options.hour, minute, options.timeZone);
    const delay = Math.min(Math.max(next.getTime() - now().getTime(), 0), MAX_TIMEOUT_MS);
    timer = setTimeout(tick, delay);
    options.logger.info(`schedule: next run at ${next.toISOString()}`);
  };

  const tick = async (): Promise<void> => {
    if (now().getTime() < next.getTime()) {
      arm();
      return;
    }
    if (running) {
      arm();
      return;
    }
    running = true;
    try {
      await options.run();
    } catch (error) {
      options.logger.error('schedule: run failed', error);
    } finally {
      running = false;
      arm();
    }
  };

  arm();
  return {
    stop: () => {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
      }
    },
    nextRunAt: () => next,
  };
}
