import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceTokensStore } from '../../../storage/workspaceTokens.js';
import type { ExecFileLike } from '../gwsExec.js';
import {
  ADD_CALENDAR_EVENT_TOOL_NAME,
  type AddCalendarEventResult,
  createAddCalendarEventTool,
} from './addCalendarEvent.js';

function fakeStore(): WorkspaceTokensStore {
  return {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(async () => undefined),
    getValidAccessToken: vi.fn(async () => 'ya29.fake'),
  };
}

function exec(tool: ReturnType<typeof createAddCalendarEventTool>, input: unknown) {
  // biome-ignore lint/suspicious/noExplicitAny: ADK internals
  return (tool as any).execute(input) as Promise<AddCalendarEventResult>;
}

describe('add_calendar_event', () => {
  it('has the expected name', () => {
    const tool = createAddCalendarEventTool({ store: fakeStore(), uid: 'u' });
    expect(tool.name).toBe(ADD_CALENDAR_EVENT_TOOL_NAME);
  });

  it('builds events.insert with default end = start + 30 min when end omitted', async () => {
    const calls: string[][] = [];
    const fakeExec: ExecFileLike = async (_bin, argv) => {
      calls.push(argv);
      return {
        stdout: JSON.stringify({
          id: 'ev1',
          summary: 'Maya parent-teacher',
          start: { dateTime: '2026-05-12T18:00:00+01:00' },
          end: { dateTime: '2026-05-12T18:30:00+01:00' },
        }),
        stderr: '',
        code: 0,
      };
    };
    const tool = createAddCalendarEventTool({
      store: fakeStore(),
      uid: 'u',
      execFile: fakeExec,
    });
    const r = await exec(tool, {
      summary: 'Maya parent-teacher',
      start: '2026-05-12T18:00:00+01:00',
    });
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.event.summary).toBe('Maya parent-teacher');

    const argv = calls[0] ?? [];
    expect(argv.slice(0, 4)).toEqual(['calendar', 'events', 'insert', '--params']);
    const body = JSON.parse(argv[argv.indexOf('--json') + 1] ?? '{}');
    expect(body.summary).toBe('Maya parent-teacher');
    expect(body.start.dateTime).toBe('2026-05-12T18:00:00+01:00');
    expect(body.end.dateTime).toBe('2026-05-12T18:30:00+01:00');
  });

  it('uses explicit end when provided', async () => {
    const calls: string[][] = [];
    const fakeExec: ExecFileLike = async (_bin, argv) => {
      calls.push(argv);
      return { stdout: JSON.stringify({ id: 'ev1' }), stderr: '', code: 0 };
    };
    const tool = createAddCalendarEventTool({
      store: fakeStore(),
      uid: 'u',
      execFile: fakeExec,
    });
    await exec(tool, {
      summary: 'Lunch',
      start: '2026-05-12T12:30:00+01:00',
      end: '2026-05-12T13:30:00+01:00',
    });
    const body = JSON.parse(calls[0]?.[calls[0]?.indexOf('--json') + 1] ?? '{}');
    expect(body.end.dateTime).toBe('2026-05-12T13:30:00+01:00');
  });

  it('treats YYYY-MM-DD as an all-day event (date, not dateTime)', async () => {
    const calls: string[][] = [];
    const fakeExec: ExecFileLike = async (_bin, argv) => {
      calls.push(argv);
      return { stdout: JSON.stringify({ id: 'ev1' }), stderr: '', code: 0 };
    };
    const tool = createAddCalendarEventTool({
      store: fakeStore(),
      uid: 'u',
      execFile: fakeExec,
    });
    await exec(tool, {
      summary: 'School holiday',
      start: '2026-05-12',
      end: '2026-05-13',
    });
    const body = JSON.parse(calls[0]?.[calls[0]?.indexOf('--json') + 1] ?? '{}');
    expect(body.start).toEqual({ date: '2026-05-12' });
    expect(body.end).toEqual({ date: '2026-05-13' });
  });

  it('passes a custom calendarId through', async () => {
    const calls: string[][] = [];
    const fakeExec: ExecFileLike = async (_bin, argv) => {
      calls.push(argv);
      return { stdout: JSON.stringify({ id: 'ev1' }), stderr: '', code: 0 };
    };
    const tool = createAddCalendarEventTool({
      store: fakeStore(),
      uid: 'u',
      execFile: fakeExec,
    });
    await exec(tool, {
      summary: 'x',
      start: '2026-05-12T09:00:00+01:00',
      calendarId: 'work@example.com',
    });
    const params = JSON.parse(calls[0]?.[calls[0]?.indexOf('--params') + 1] ?? '{}');
    expect(params.calendarId).toBe('work@example.com');
  });

  it('propagates errors', async () => {
    const fakeExec: ExecFileLike = async () => ({
      stdout: JSON.stringify({ error: { code: 403, message: 'forbidden' } }),
      stderr: '',
      code: 1,
    });
    const tool = createAddCalendarEventTool({
      store: fakeStore(),
      uid: 'u',
      execFile: fakeExec,
    });
    const r = await exec(tool, { summary: 'x', start: '2026-05-12T09:00:00+01:00' });
    expect(r).toMatchObject({ status: 'error', code: 'forbidden' });
  });
});
