import { mapCalendarEvents, CALENDAR_SCOPE } from './calendar';

describe('mapCalendarEvents', () => {
  it('maps timed and all-day events, counts other attendees, drops cancelled and untitled', () => {
    const events = mapCalendarEvents(
      [
        {
          summary: 'Board prep',
          location: 'Room 4',
          start: { dateTime: '2026-06-10T13:30:00Z' },
          end: { dateTime: '2026-06-10T14:00:00Z' },
          attendees: [
            { self: true },
            { responseStatus: 'accepted' },
            { responseStatus: 'needsAction' },
          ],
        },
        { summary: 'Offsite', start: { date: '2026-06-10' }, end: { date: '2026-06-11' } },
        {
          summary: 'Cancelled thing',
          status: 'cancelled',
          start: { dateTime: '2026-06-10T15:00:00Z' },
        },
        { summary: '   ', start: { dateTime: '2026-06-10T16:00:00Z' } },
      ],
      'America/New_York',
    );
    expect(events).toEqual([
      { start: '09:30', end: '10:00', title: 'Board prep', location: 'Room 4', attendees: 2 },
      { start: 'all day', end: 'all day', title: 'Offsite', attendees: 0 },
    ]);
    expect(CALENDAR_SCOPE).toContain('calendar.readonly');
  });
});
