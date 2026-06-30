import { describe, expect, it } from 'vitest';
import {
  BackgroundNotificationSchema,
  BackgroundProposedActionSchema,
  BackgroundRunSchema,
  BackgroundScheduleSchema,
  sanitizeTaskId,
} from './background.js';

const validSchedule = {
  id: 'sched_abc123',
  uid: 'uid-1',
  kind: 'email_triage_daily',
  enabled: true,
  timezone: 'Europe/London',
  cadence: { type: 'daily', localTime: '08:00', weekdays: [1, 2, 3, 4, 5] },
  lookbackWindow: '1d',
  consentVersion: 'v1',
  permittedActions: {
    archiveNoise: 'after_confirmation',
    createTasks: 'never',
    createCalendarEvents: 'never',
  },
  notify: { inApp: true, email: false, chatSummaryOnNextOpen: true },
  nextRunAt: '2026-05-15T07:00:00.000Z',
  createdAt: '2026-05-01T00:00:00.000Z',
  updatedAt: '2026-05-01T00:00:00.000Z',
};

const validRun = {
  id: 'run_20260515_080000Z_3ff1a2',
  uid: 'uid-1',
  scheduleId: 'sched_abc123',
  kind: 'email_triage_daily',
  status: 'queued',
  idempotencyKey: 'sched_abc123:email_triage_daily:2026-05-15T08:00:00Z',
  scheduledFor: '2026-05-15T08:00:00.000Z',
  inputWindowStart: '2026-05-14T08:00:00.000Z',
  inputWindowEnd: '2026-05-15T08:00:00.000Z',
  attempt: 0,
  createdAt: '2026-05-15T07:55:00.000Z',
};

const validProposedAction = {
  id: 'act_1',
  uid: 'uid-1',
  runId: 'run_20260515_080000Z_3ff1a2',
  type: 'archive_message',
  status: 'proposed',
  sourceMessageIds: ['m1', 'm2'],
  summary: 'Archive 2 newsletters from last week',
  createdAt: '2026-05-15T08:00:01.000Z',
};

const validNotification = {
  id: 'note_1',
  uid: 'uid-1',
  runId: 'run_20260515_080000Z_3ff1a2',
  kind: 'email_triage_daily',
  status: 'unread',
  title: 'Morning inbox digest',
  summary: '2 actions, 1 event, 3 noise',
  items: [
    { messageId: 'm1', threadId: 't1', bucket: 'noise', subject: 'Digest', snippet: 'Top stories' },
    { messageId: 'm2', bucket: 'actions', subject: 'Sign-off', snippet: 'Please sign by Friday' },
  ],
  proposedActions: ['act_1'],
  createdAt: '2026-05-15T08:00:02.000Z',
};

describe('BackgroundScheduleSchema', () => {
  it('accepts a fully-specified schedule', () => {
    expect(BackgroundScheduleSchema.parse(validSchedule)).toEqual(validSchedule);
  });

  it('rejects an unknown workflow kind', () => {
    expect(() =>
      BackgroundScheduleSchema.parse({ ...validSchedule, kind: 'send_email' }),
    ).toThrow();
  });

  it('rejects a non-HH:MM localTime', () => {
    const bad = { ...validSchedule, cadence: { type: 'daily', localTime: '8am' } };
    expect(() => BackgroundScheduleSchema.parse(bad)).toThrow();
  });

  it('rejects an out-of-range weekday', () => {
    const bad = { ...validSchedule, cadence: { type: 'daily', localTime: '08:00', weekdays: [7] } };
    expect(() => BackgroundScheduleSchema.parse(bad)).toThrow();
  });

  it('rejects a non-ISO nextRunAt', () => {
    expect(() => BackgroundScheduleSchema.parse({ ...validSchedule, nextRunAt: 'soon' })).toThrow();
  });

  it('rejects an offset (non-Z) timestamp', () => {
    expect(() =>
      BackgroundScheduleSchema.parse({ ...validSchedule, nextRunAt: '2026-05-15T08:00:00+00:00' }),
    ).toThrow();
  });

  it('rejects null weekdays (optional means omit, not null)', () => {
    const bad = {
      ...validSchedule,
      cadence: { type: 'daily', localTime: '08:00', weekdays: null },
    };
    expect(() => BackgroundScheduleSchema.parse(bad)).toThrow();
  });

  it('rejects an unresolvable timezone', () => {
    expect(() =>
      BackgroundScheduleSchema.parse({ ...validSchedule, timezone: 'not-a-zone' }),
    ).toThrow();
  });

  it('rejects unknown keys', () => {
    expect(() => BackgroundScheduleSchema.parse({ ...validSchedule, extra: 1 })).toThrow();
  });
});

describe('BackgroundRunSchema', () => {
  it('accepts a queued run', () => {
    expect(BackgroundRunSchema.parse(validRun)).toEqual(validRun);
  });

  it('rejects an unknown status', () => {
    expect(() => BackgroundRunSchema.parse({ ...validRun, status: 'pending' })).toThrow();
  });

  it('rejects a negative attempt', () => {
    expect(() => BackgroundRunSchema.parse({ ...validRun, attempt: -1 })).toThrow();
  });

  it('rejects a negative tokenCostEstimate', () => {
    expect(() => BackgroundRunSchema.parse({ ...validRun, tokenCostEstimate: -0.1 })).toThrow();
  });
});

describe('BackgroundProposedActionSchema', () => {
  it('accepts a proposed archive action', () => {
    expect(BackgroundProposedActionSchema.parse(validProposedAction)).toEqual(validProposedAction);
  });

  it('rejects an unknown action type', () => {
    const bad = { ...validProposedAction, type: 'send_email' };
    expect(() => BackgroundProposedActionSchema.parse(bad)).toThrow();
  });

  it('rejects empty sourceMessageIds', () => {
    const bad = { ...validProposedAction, sourceMessageIds: [] };
    expect(() => BackgroundProposedActionSchema.parse(bad)).toThrow();
  });

  it('accepts an executed action with a result', () => {
    const acted = {
      ...validProposedAction,
      status: 'executed',
      result: { ok: true, ref: 'thread-1' },
    };
    expect(BackgroundProposedActionSchema.parse(acted)).toEqual(acted);
  });
});

describe('BackgroundNotificationSchema', () => {
  it('accepts a digest with items + proposed action ids', () => {
    expect(BackgroundNotificationSchema.parse(validNotification)).toEqual(validNotification);
  });

  it('rejects an unknown bucket on an item', () => {
    const bad = structuredClone(validNotification);
    (bad.items[0] as { bucket: string }).bucket = 'urgent';
    expect(() => BackgroundNotificationSchema.parse(bad)).toThrow();
  });

  it('rejects an unknown status', () => {
    expect(() =>
      BackgroundNotificationSchema.parse({ ...validNotification, status: 'archived' }),
    ).toThrow();
  });
});

describe('sanitizeTaskId', () => {
  it('replaces colons in an ISO timestamp with underscores', () => {
    expect(sanitizeTaskId('2026-05-15T08:00:00Z')).toBe('2026-05-15T08_00_00Z');
  });

  it('leaves an already-valid deterministic id untouched', () => {
    const id = 'background-email_triage_daily-a1b2c3d4-20260515T080000Z-7f9e2a';
    expect(sanitizeTaskId(id)).toBe(id);
  });

  it('replaces dots, slashes, and @ from raw identifiers', () => {
    expect(sanitizeTaskId('a.b/c@d')).toBe('a_b_c_d');
  });

  it('keeps letters, numbers, hyphens, and underscores', () => {
    expect(sanitizeTaskId('A-z_0-9')).toBe('A-z_0-9');
  });
});
