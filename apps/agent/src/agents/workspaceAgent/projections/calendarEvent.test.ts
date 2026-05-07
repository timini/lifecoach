import { EventProjectionSchema } from '@lifecoach/shared-types';
import { describe, expect, it } from 'vitest';
import { projectCalendarEvent } from './calendarEvent.js';

describe('projectCalendarEvent', () => {
  it('projects a timed event with attendees and link', () => {
    const projection = projectCalendarEvent(
      {
        id: 'ev1',
        summary: 'Lunch with Sarah',
        start: { dateTime: '2026-05-12T12:30:00+01:00', timeZone: 'Europe/London' },
        end: { dateTime: '2026-05-12T13:30:00+01:00', timeZone: 'Europe/London' },
        location: 'Trattoria Sarah',
        attendees: [
          { email: 'sarah@example.com', responseStatus: 'accepted' },
          { email: 'tim@example.com', responseStatus: 'needsAction' },
        ],
        htmlLink: 'https://calendar.google.com/event?eid=…',
        status: 'confirmed',
      },
      'primary',
    );

    expect(projection.id).toBe('ev1');
    expect(projection.calendarId).toBe('primary');
    expect(projection.summary).toBe('Lunch with Sarah');
    expect(projection.start.dateTime).toBe('2026-05-12T12:30:00+01:00');
    expect(projection.attendees).toEqual(['sarah@example.com', 'tim@example.com']);
    expect(projection.link).toBe('https://calendar.google.com/event?eid=…');
    expect(EventProjectionSchema.parse(projection)).toEqual(projection);
  });

  it('projects an all-day event (date, not dateTime)', () => {
    const projection = projectCalendarEvent({
      id: 'ev2',
      summary: 'School holiday',
      start: { date: '2026-05-12' },
      end: { date: '2026-05-13' },
    });
    expect(projection.start.date).toBe('2026-05-12');
    expect(projection.start.dateTime).toBeUndefined();
  });

  it('falls back to "(no title)" when summary missing', () => {
    const projection = projectCalendarEvent({ id: 'ev3' });
    expect(projection.summary).toBe('(no title)');
  });

  it('omits attendees when none have email addresses', () => {
    const projection = projectCalendarEvent({
      id: 'ev4',
      summary: 'Solo focus',
      start: { dateTime: '2026-05-12T09:00:00+01:00' },
      end: { dateTime: '2026-05-12T10:00:00+01:00' },
      attendees: [{ responseStatus: 'accepted' }],
    });
    expect(projection.attendees).toBeUndefined();
  });

  it('does not set calendarId when not provided', () => {
    const projection = projectCalendarEvent({
      id: 'ev5',
      summary: 'x',
      start: { date: '2026-05-12' },
      end: { date: '2026-05-13' },
    });
    expect(projection.calendarId).toBeUndefined();
  });

  it('handles a missing start/end shape gracefully', () => {
    const projection = projectCalendarEvent({ id: 'ev6', summary: 'x' });
    expect(projection.start).toEqual({});
    expect(projection.end).toEqual({});
    expect(EventProjectionSchema.parse(projection)).toEqual(projection);
  });
});
