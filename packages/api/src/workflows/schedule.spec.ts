import { nextOccurrence, dayBounds, zonedParts, startDailySchedule } from './schedule';

const NY = 'America/New_York';

describe('nextOccurrence', () => {
  it('picks later today when the time has not passed', () => {
    const now = new Date('2026-06-10T09:00:00Z');
    expect(nextOccurrence(now, 7, 0, NY).toISOString()).toBe('2026-06-10T11:00:00.000Z');
  });

  it('rolls to tomorrow when the time already passed', () => {
    const now = new Date('2026-06-10T15:00:00Z');
    expect(nextOccurrence(now, 7, 0, NY).toISOString()).toBe('2026-06-11T11:00:00.000Z');
  });

  it('crosses the spring-forward DST boundary on local wall-clock time', () => {
    const now = new Date('2026-03-07T12:30:00Z');
    const next = nextOccurrence(now, 7, 0, NY);
    expect(next.toISOString()).toBe('2026-03-08T11:00:00.000Z');
    expect(zonedParts(next, NY)).toMatchObject({ month: 3, day: 8, hour: 7, minute: 0 });
  });

  it('rolls month and year boundaries', () => {
    const now = new Date('2026-12-31T23:30:00Z');
    expect(nextOccurrence(now, 7, 30, 'UTC').toISOString()).toBe('2027-01-01T07:30:00.000Z');
  });
});

describe('dayBounds', () => {
  it('returns the zone-local day containing the instant', () => {
    const { start, end } = dayBounds(new Date('2026-06-10T02:00:00Z'), NY);
    expect(start.toISOString()).toBe('2026-06-09T04:00:00.000Z');
    expect(end.toISOString()).toBe('2026-06-10T04:00:00.000Z');
  });
});

describe('startDailySchedule', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('runs once at the next occurrence and re-arms for the following day', async () => {
    let clock = new Date('2026-06-10T10:59:59Z').getTime();
    jest.setSystemTime(clock);
    const run = jest.fn(async () => undefined);
    const logger = { info: jest.fn(), error: jest.fn() };
    const handle = startDailySchedule({
      hour: 7,
      timeZone: NY,
      run,
      logger,
      now: () => new Date(clock),
    });
    expect(handle.nextRunAt().toISOString()).toBe('2026-06-10T11:00:00.000Z');

    clock += 1000;
    jest.setSystemTime(clock);
    await jest.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(handle.nextRunAt().toISOString()).toBe('2026-06-11T11:00:00.000Z');
    handle.stop();
  });

  it('logs and re-arms when a run throws', async () => {
    let clock = new Date('2026-06-10T10:59:59Z').getTime();
    const logger = { info: jest.fn(), error: jest.fn() };
    const handle = startDailySchedule({
      hour: 7,
      timeZone: NY,
      run: async () => {
        throw new Error('boom');
      },
      logger,
      now: () => new Date(clock),
    });
    clock += 1000;
    await jest.advanceTimersByTimeAsync(1000);
    expect(logger.error).toHaveBeenCalledWith('schedule: run failed', expect.any(Error));
    expect(handle.nextRunAt().toISOString()).toBe('2026-06-11T11:00:00.000Z');
    handle.stop();
  });
});
