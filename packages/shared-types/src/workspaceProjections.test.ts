import { describe, expect, it } from 'vitest';
import {
  EventProjectionSchema,
  MessageProjectionSchema,
  TaskProjectionSchema,
  TriageReportSchema,
} from './workspaceProjections.js';

describe('MessageProjectionSchema', () => {
  it('accepts a minimal projected message', () => {
    const parsed = MessageProjectionSchema.parse({
      id: '18a',
      threadId: '18a',
      from: 'Sarah <sarah@example.com>',
      subject: 'Lunch?',
      date: 'Mon, 06 May 2026 09:12:00 +0100',
      snippet: 'Are you free…',
      body: 'Are you free for lunch on Tuesday?',
      truncated: false,
    });
    expect(parsed.id).toBe('18a');
    expect(parsed.truncated).toBe(false);
  });

  it('accepts an optional headers record', () => {
    const parsed = MessageProjectionSchema.parse({
      id: '18a',
      threadId: '18a',
      from: 'Sarah <sarah@example.com>',
      subject: 'Lunch?',
      date: 'Mon, 06 May 2026 09:12:00 +0100',
      snippet: '',
      body: '',
      truncated: false,
      headers: { 'List-Unsubscribe': '<https://example.com/u>' },
    });
    expect(parsed.headers).toEqual({ 'List-Unsubscribe': '<https://example.com/u>' });
  });

  it('rejects unknown fields (no payload leakage past projection)', () => {
    expect(() =>
      MessageProjectionSchema.parse({
        id: '18a',
        threadId: '18a',
        from: '',
        subject: '',
        date: '',
        snippet: '',
        body: '',
        truncated: false,
        payload: { mimeType: 'text/plain' },
      }),
    ).toThrow();
  });
});

describe('EventProjectionSchema', () => {
  it('accepts a timed event', () => {
    const parsed = EventProjectionSchema.parse({
      id: 'ev1',
      summary: 'Lunch with Sarah',
      start: { dateTime: '2026-05-12T12:30:00+01:00', timeZone: 'Europe/London' },
      end: { dateTime: '2026-05-12T13:30:00+01:00', timeZone: 'Europe/London' },
    });
    expect(parsed.start.dateTime).toBe('2026-05-12T12:30:00+01:00');
  });

  it('accepts an all-day event (date, not dateTime)', () => {
    const parsed = EventProjectionSchema.parse({
      id: 'ev2',
      summary: 'School holiday',
      start: { date: '2026-05-12' },
      end: { date: '2026-05-13' },
    });
    expect(parsed.start.date).toBe('2026-05-12');
    expect(parsed.end.date).toBe('2026-05-13');
  });
});

describe('TaskProjectionSchema', () => {
  it('accepts a needsAction task', () => {
    const parsed = TaskProjectionSchema.parse({
      id: 't1',
      taskListId: '@default',
      title: 'Reply to Maya',
      status: 'needsAction',
    });
    expect(parsed.status).toBe('needsAction');
  });

  it('accepts a completed task with timestamps', () => {
    const parsed = TaskProjectionSchema.parse({
      id: 't1',
      taskListId: '@default',
      title: 'Reply to Maya',
      status: 'completed',
      due: '2026-05-08T00:00:00.000Z',
      completed: '2026-05-07T11:00:00.000Z',
      notes: 'Sent over Slack.',
    });
    expect(parsed.completed).toBe('2026-05-07T11:00:00.000Z');
  });

  it('rejects an unknown status', () => {
    expect(() =>
      TaskProjectionSchema.parse({
        id: 't1',
        taskListId: '@default',
        title: 'x',
        status: 'in_progress',
      }),
    ).toThrow();
  });
});

describe('TriageReportSchema', () => {
  it('accepts an empty report (all four buckets, all empty)', () => {
    const parsed = TriageReportSchema.parse({
      noise: [],
      actions: [],
      events: [],
      info: [],
    });
    expect(parsed.noise).toEqual([]);
  });

  it('accepts a populated report', () => {
    const parsed = TriageReportSchema.parse({
      noise: [{ id: 'n1', from: 'Substack', subject: 'Weekly digest' }],
      actions: [
        {
          id: 'a1',
          from: 'finance@example.com',
          subject: 'Invoice waiting',
          task: 'Pay invoice 2031',
        },
      ],
      events: [
        {
          id: 'e1',
          subject: 'Maya parent-teacher',
          proposedStart: '2026-05-12T18:00:00+01:00',
          proposedEnd: '2026-05-12T18:30:00+01:00',
          location: 'School',
        },
      ],
      info: [{ id: 'i1', from: 'School', subject: 'Term dates', note: 'Holiday May 12.' }],
    });
    expect(parsed.actions[0].task).toBe('Pay invoice 2031');
  });

  it('rejects a report missing a bucket', () => {
    expect(() =>
      TriageReportSchema.parse({
        noise: [],
        actions: [],
        events: [],
        // info missing
      }),
    ).toThrow();
  });

  it('rejects a report with an unknown bucket', () => {
    expect(() =>
      TriageReportSchema.parse({
        noise: [],
        actions: [],
        events: [],
        info: [],
        misc: [{ id: 'x' }],
      }),
    ).toThrow();
  });

  it('rejects an action without the task field', () => {
    expect(() =>
      TriageReportSchema.parse({
        noise: [],
        actions: [{ id: 'a1', from: 'x', subject: 'y' }],
        events: [],
        info: [],
      }),
    ).toThrow();
  });
});
