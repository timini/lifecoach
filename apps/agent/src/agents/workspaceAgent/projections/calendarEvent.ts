import type { EventProjection } from '@lifecoach/shared-types';

/**
 * Project a raw `calendar.events.list` / `events.get` response into the
 * shape the LLM consumes. Drops fields the coach doesn't need (creator,
 * organiser, sequence, etag, etc.) and shrinks the attendee list to a
 * flat email array.
 *
 * `start` / `end` keep both `dateTime` and `date` keys because the API
 * returns whichever of the two it uses (timed vs all-day events).
 */

interface RawTime {
  dateTime?: string;
  date?: string;
  timeZone?: string;
}

interface RawAttendee {
  email?: string;
  responseStatus?: string;
}

export interface RawEvent {
  id?: string;
  summary?: string;
  start?: RawTime;
  end?: RawTime;
  location?: string;
  attendees?: RawAttendee[];
  htmlLink?: string;
  status?: string;
  description?: string;
}

export function projectCalendarEvent(raw: RawEvent, calendarId?: string): EventProjection {
  const projection: EventProjection = {
    id: raw.id ?? '',
    summary: raw.summary ?? '(no title)',
    start: pickTime(raw.start),
    end: pickTime(raw.end),
  };
  if (calendarId !== undefined) projection.calendarId = calendarId;
  if (raw.location) projection.location = raw.location;
  if (raw.htmlLink) projection.link = raw.htmlLink;
  if (raw.status) projection.status = raw.status;
  if (raw.description) projection.description = raw.description;

  const attendeeEmails = (raw.attendees ?? [])
    .map((a) => a.email)
    .filter((email): email is string => typeof email === 'string' && email.length > 0);
  if (attendeeEmails.length > 0) {
    projection.attendees = attendeeEmails;
  }

  return projection;
}

function pickTime(time: RawTime | undefined): EventProjection['start'] {
  if (!time) return {};
  const out: EventProjection['start'] = {};
  if (time.dateTime) out.dateTime = time.dateTime;
  if (time.date) out.date = time.date;
  if (time.timeZone) out.timeZone = time.timeZone;
  return out;
}
