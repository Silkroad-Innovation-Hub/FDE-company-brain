import { calendar, auth } from '@googleapis/calendar';
import type { calendar_v3 } from '@googleapis/calendar';
import { dayBounds, zonedParts } from './schedule';

export const CALENDAR_SCOPE: string = 'https://www.googleapis.com/auth/calendar.readonly';

export interface CalendarEvent {
  start: string;
  end: string;
  title: string;
  location?: string;
  attendees: number;
}

export interface CalendarApi {
  listToday: (timeZone: string, now?: Date) => Promise<CalendarEvent[]>;
}

export interface CalendarClientConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

/** The slice of a Google Calendar event the brief reads. */
export interface RawCalendarEvent {
  summary?: string | null;
  location?: string | null;
  status?: string | null;
  start?: { dateTime?: string | null; date?: string | null } | null;
  end?: { dateTime?: string | null; date?: string | null } | null;
  attendees?: Array<{ self?: boolean | null; responseStatus?: string | null }> | null;
}

const ALL_DAY = 'all day';
const MAX_EVENTS = 12;

function clock(iso: string, timeZone: string): string {
  const parts = zonedParts(new Date(iso), timeZone);
  return `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

/** Pure mapping from API events to the brief's shape; cancelled and untitled events are dropped. */
export function mapCalendarEvents(items: RawCalendarEvent[], timeZone: string): CalendarEvent[] {
  return items
    .filter((item) => item.status !== 'cancelled' && (item.summary ?? '').trim().length > 0)
    .slice(0, MAX_EVENTS)
    .map((item) => {
      const allDay = !item.start?.dateTime;
      return {
        start: allDay ? ALL_DAY : clock(item.start?.dateTime ?? '', timeZone),
        end: allDay ? ALL_DAY : clock(item.end?.dateTime ?? '', timeZone),
        title: (item.summary ?? '').trim(),
        ...(item.location ? { location: item.location } : {}),
        attendees: (item.attendees ?? []).filter((attendee) => attendee.self !== true).length,
      };
    });
}

/** Read-only Google Calendar on the same OAuth client as Gmail (brief §6: read-only by default). */
export function createCalendarClient(config: CalendarClientConfig): CalendarApi {
  const oauth = new auth.OAuth2(config.clientId, config.clientSecret);
  oauth.setCredentials({ refresh_token: config.refreshToken });
  const api: calendar_v3.Calendar = calendar({ version: 'v3', auth: oauth });

  async function listToday(timeZone: string, now: Date = new Date()): Promise<CalendarEvent[]> {
    const { start, end } = dayBounds(now, timeZone);
    const { data } = await api.events.list({
      calendarId: 'primary',
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 50,
      timeZone,
    });
    return mapCalendarEvents((data.items ?? []) as RawCalendarEvent[], timeZone);
  }

  return { listToday };
}
