import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScopeRequiredError, type WorkspaceTokensStore } from '../storage/workspaceTokens.js';
import type { ExecFileLike, ExecFileResult } from '../tools/callWorkspace.js';
import { createCalendarDensityClient } from './calendarDensity.js';

function fakeStore(token = 'fake-access-token'): WorkspaceTokensStore {
  return {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn().mockResolvedValue(undefined),
    getValidAccessToken: vi.fn().mockResolvedValue(token),
  };
}

function fakeExec(stdout: unknown, code = 0, stderr = ''): ExecFileLike {
  return vi.fn(
    async (): Promise<ExecFileResult> => ({
      stdout: typeof stdout === 'string' ? stdout : JSON.stringify(stdout),
      stderr,
      code,
    }),
  );
}

const NOW = new Date('2026-04-28T08:30:00Z'); // 09:30 London, BST

const GWS_RESPONSE = {
  items: [
    {
      id: 'a',
      summary: 'Standup',
      start: { dateTime: '2026-04-28T10:00:00+01:00' },
      end: { dateTime: '2026-04-28T10:30:00+01:00' },
    },
    {
      id: 'b',
      summary: 'Lunch',
      start: { dateTime: '2026-04-28T13:00:00+01:00' },
      end: { dateTime: '2026-04-28T14:00:00+01:00' },
    },
    {
      id: 'c',
      summary: '1:1',
      start: { dateTime: '2026-04-28T16:00:00+01:00' },
      end: { dateTime: '2026-04-28T17:30:00+01:00' },
    },
    // tomorrow — 8 events, heavy day
    {
      id: 'd1',
      summary: 'kickoff',
      start: { dateTime: '2026-04-29T09:00:00+01:00' },
      end: { dateTime: '2026-04-29T09:30:00+01:00' },
    },
    {
      id: 'd2',
      start: { dateTime: '2026-04-29T10:00:00+01:00' },
      end: { dateTime: '2026-04-29T10:30:00+01:00' },
    },
    {
      id: 'd3',
      start: { dateTime: '2026-04-29T11:00:00+01:00' },
      end: { dateTime: '2026-04-29T11:30:00+01:00' },
    },
    {
      id: 'd4',
      start: { dateTime: '2026-04-29T12:00:00+01:00' },
      end: { dateTime: '2026-04-29T12:30:00+01:00' },
    },
    {
      id: 'd5',
      start: { dateTime: '2026-04-29T13:00:00+01:00' },
      end: { dateTime: '2026-04-29T13:30:00+01:00' },
    },
    {
      id: 'd6',
      start: { dateTime: '2026-04-29T14:00:00+01:00' },
      end: { dateTime: '2026-04-29T14:30:00+01:00' },
    },
    {
      id: 'd7',
      start: { dateTime: '2026-04-29T16:00:00+01:00' },
      end: { dateTime: '2026-04-29T16:30:00+01:00' },
    },
    {
      id: 'd8',
      start: { dateTime: '2026-04-29T17:30:00+01:00' },
      end: { dateTime: '2026-04-29T18:00:00+01:00' },
    },
  ],
};

describe('createCalendarDensityClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns bucketed today + tomorrow summary for a real calendar response', async () => {
    const client = createCalendarDensityClient({
      store: fakeStore(),
      exec: fakeExec(GWS_RESPONSE),
    });
    const summary = await client.get({ uid: 'u1', timezone: 'Europe/London', now: NOW });
    expect(summary).toEqual({
      today: {
        count: 3,
        firstStart: '10:00',
        lastEnd: '17:30',
        // The next event after 09:30 is the 10:00 standup.
        nextStart: '10:00',
        events: [
          { summary: 'Standup', start: '10:00', end: '10:30', allDay: false },
          { summary: 'Lunch', start: '13:00', end: '14:00', allDay: false },
          { summary: '1:1', start: '16:00', end: '17:30', allDay: false },
        ],
      },
      tomorrow: {
        count: 8,
        firstStart: '09:00',
        lastEnd: '18:00',
      },
    });
  });

  it('passes the access token via env, never argv', async () => {
    const exec = fakeExec(GWS_RESPONSE) as ReturnType<typeof vi.fn>;
    const client = createCalendarDensityClient({
      store: fakeStore('secret-token-xyz'),
      exec: exec as unknown as ExecFileLike,
    });
    await client.get({ uid: 'u1', timezone: 'Europe/London', now: NOW });
    const [_file, args, options] = exec.mock.calls[0] as [
      string,
      string[],
      { env: NodeJS.ProcessEnv },
    ];
    expect(args.join(' ')).not.toContain('secret-token-xyz');
    expect(options.env.GOOGLE_WORKSPACE_CLI_TOKEN).toBe('secret-token-xyz');
  });

  it('invokes gws calendar events list with the right argv shape', async () => {
    const exec = fakeExec(GWS_RESPONSE) as ReturnType<typeof vi.fn>;
    const client = createCalendarDensityClient({
      store: fakeStore(),
      exec: exec as unknown as ExecFileLike,
    });
    await client.get({ uid: 'u1', timezone: 'Europe/London', now: NOW });
    const [file, args] = exec.mock.calls[0] as [string, string[]];
    expect(file).toBe('gws');
    expect(args.slice(0, 4)).toEqual(['calendar', 'events', 'list', '--params']);
    const params = JSON.parse(args[4] as string);
    expect(params.calendarId).toBe('primary');
    expect(params.singleEvents).toBe(true);
    expect(typeof params.timeMin).toBe('string');
    expect(typeof params.timeMax).toBe('string');
  });

  it('caches per (uid, tz) for 5 minutes by default', async () => {
    const exec = fakeExec(GWS_RESPONSE) as ReturnType<typeof vi.fn>;
    const client = createCalendarDensityClient({
      store: fakeStore(),
      exec: exec as unknown as ExecFileLike,
    });
    await client.get({ uid: 'u1', timezone: 'Europe/London', now: new Date(NOW) });
    await client.get({ uid: 'u1', timezone: 'Europe/London', now: new Date(NOW) });
    expect(exec).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(4 * 60_000);
    await client.get({ uid: 'u1', timezone: 'Europe/London', now: new Date() });
    expect(exec).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2 * 60_000);
    await client.get({ uid: 'u1', timezone: 'Europe/London', now: new Date() });
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it('separate cache entries per uid', async () => {
    const exec = fakeExec(GWS_RESPONSE) as ReturnType<typeof vi.fn>;
    const client = createCalendarDensityClient({
      store: fakeStore(),
      exec: exec as unknown as ExecFileLike,
    });
    await client.get({ uid: 'u1', timezone: 'Europe/London', now: NOW });
    await client.get({ uid: 'u2', timezone: 'Europe/London', now: NOW });
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it('returns null on ScopeRequiredError (token gone) — never fails the turn', async () => {
    const store = fakeStore();
    (store.getValidAccessToken as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new ScopeRequiredError(),
    );
    const client = createCalendarDensityClient({ store, exec: fakeExec(GWS_RESPONSE) });
    const summary = await client.get({ uid: 'u1', timezone: 'Europe/London', now: NOW });
    expect(summary).toBeNull();
  });

  it('returns null on non-zero gws exit (graceful)', async () => {
    const client = createCalendarDensityClient({
      store: fakeStore(),
      exec: fakeExec('', 1, 'oh no'),
    });
    const summary = await client.get({ uid: 'u1', timezone: 'Europe/London', now: NOW });
    expect(summary).toBeNull();
  });

  it('returns null when stdout is not parseable JSON', async () => {
    const client = createCalendarDensityClient({
      store: fakeStore(),
      exec: fakeExec('not json'),
    });
    const summary = await client.get({ uid: 'u1', timezone: 'Europe/London', now: NOW });
    expect(summary).toBeNull();
  });

  it('returns zero-count summary when calendar is empty', async () => {
    const client = createCalendarDensityClient({
      store: fakeStore(),
      exec: fakeExec({ items: [] }),
    });
    const summary = await client.get({ uid: 'u1', timezone: 'Europe/London', now: NOW });
    expect(summary).toEqual({
      today: { count: 0, firstStart: null, lastEnd: null, nextStart: null, events: [] },
      tomorrow: { count: 0, firstStart: null, lastEnd: null },
    });
  });

  it('counts all-day events (start.date) but does not include them in time fields', async () => {
    const client = createCalendarDensityClient({
      store: fakeStore(),
      exec: fakeExec({
        items: [
          {
            id: 'allday',
            summary: 'birthday',
            start: { date: '2026-04-28' },
            end: { date: '2026-04-29' },
          },
          {
            id: 'a',
            summary: 'standup',
            start: { dateTime: '2026-04-28T11:00:00+01:00' },
            end: { dateTime: '2026-04-28T12:00:00+01:00' },
          },
        ],
      }),
    });
    const summary = await client.get({ uid: 'u1', timezone: 'Europe/London', now: NOW });
    expect(summary?.today).toEqual({
      count: 2,
      firstStart: '11:00',
      lastEnd: '12:00',
      nextStart: '11:00',
      events: [
        // All-day events float to the top of the events list.
        { summary: 'birthday', start: null, end: null, allDay: true },
        { summary: 'standup', start: '11:00', end: '12:00', allDay: false },
      ],
    });
  });

  it('caps inline today events at TODAY_EVENT_LIMIT (10) but count reflects the full total', async () => {
    const items = Array.from({ length: 15 }, (_, i) => {
      // 06:00, 06:30, 07:00, ... well-ordered so we can spot-check the slice.
      const startMin = 6 * 60 + i * 30;
      const hh = String(Math.floor(startMin / 60)).padStart(2, '0');
      const mm = String(startMin % 60).padStart(2, '0');
      return {
        id: `e${i}`,
        summary: `event-${i}`,
        start: { dateTime: `2026-04-28T${hh}:${mm}:00+01:00` },
        end: { dateTime: `2026-04-28T${hh}:${mm}:00+01:00` },
      };
    });
    const client = createCalendarDensityClient({
      store: fakeStore(),
      exec: fakeExec({ items }),
    });
    const summary = await client.get({ uid: 'u1', timezone: 'Europe/London', now: NOW });
    expect(summary?.today.count).toBe(15);
    expect(summary?.today.events).toHaveLength(10);
    expect(summary?.today.events[0]?.summary).toBe('event-0');
    expect(summary?.today.events[9]?.summary).toBe('event-9');
  });

  it('falls back to "(no title)" when an event has no summary', async () => {
    const client = createCalendarDensityClient({
      store: fakeStore(),
      exec: fakeExec({
        items: [
          {
            id: 'a',
            // no summary field at all
            start: { dateTime: '2026-04-28T11:00:00+01:00' },
            end: { dateTime: '2026-04-28T12:00:00+01:00' },
          },
        ],
      }),
    });
    const summary = await client.get({ uid: 'u1', timezone: 'Europe/London', now: NOW });
    expect(summary?.today.events[0]?.summary).toBe('(no title)');
  });

  it('nextStart is null when all today events are already past', async () => {
    vi.setSystemTime(new Date('2026-04-28T18:00:00Z')); // 19:00 London
    const client = createCalendarDensityClient({
      store: fakeStore(),
      exec: fakeExec(GWS_RESPONSE),
    });
    const summary = await client.get({
      uid: 'u1',
      timezone: 'Europe/London',
      now: new Date('2026-04-28T18:00:00Z'),
    });
    expect(summary?.today.nextStart).toBeNull();
    expect(summary?.today.count).toBe(3); // events still counted
  });
});
