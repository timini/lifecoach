import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceTokensStore } from '../../../storage/workspaceTokens.js';
import type { ExecFileLike } from '../gwsExec.js';
import {
  LIST_EVENTS_TOOL_NAME,
  type ListEventsResult,
  createListEventsTool,
} from './listEvents.js';

function fakeStore(): WorkspaceTokensStore {
  return {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(async () => undefined),
    getValidAccessToken: vi.fn(async () => 'ya29.fake'),
  };
}

function exec(tool: ReturnType<typeof createListEventsTool>, input: unknown) {
  // biome-ignore lint/suspicious/noExplicitAny: ADK internals
  return (tool as any).execute(input) as Promise<ListEventsResult>;
}

describe('list_events', () => {
  it('has the expected name', () => {
    const tool = createListEventsTool({ store: fakeStore(), uid: 'u' });
    expect(tool.name).toBe(LIST_EVENTS_TOOL_NAME);
  });

  it('builds the gws calendar.events.list call with sensible defaults (calendarId=primary, singleEvents+orderBy)', async () => {
    const calls: string[][] = [];
    const fakeExec: ExecFileLike = async (_bin, argv) => {
      calls.push(argv);
      return { stdout: JSON.stringify({ items: [] }), stderr: '', code: 0 };
    };
    const tool = createListEventsTool({ store: fakeStore(), uid: 'u', execFile: fakeExec });
    await exec(tool, { timeMin: '2026-05-12T00:00:00Z', timeMax: '2026-05-13T00:00:00Z' });
    const argv = calls[0] ?? [];
    expect(argv.slice(0, 4)).toEqual(['calendar', 'events', 'list', '--params']);
    const params = JSON.parse(argv[argv.indexOf('--params') + 1] ?? '{}');
    expect(params.calendarId).toBe('primary');
    expect(params.singleEvents).toBe(true);
    expect(params.orderBy).toBe('startTime');
    expect(params.timeMin).toBe('2026-05-12T00:00:00Z');
    expect(params.timeMax).toBe('2026-05-13T00:00:00Z');
  });

  it('projects each event through projectCalendarEvent (drops bloat, threads calendarId)', async () => {
    const fakeExec: ExecFileLike = async () => ({
      stdout: JSON.stringify({
        items: [
          {
            id: 'ev1',
            summary: 'Lunch with Sarah',
            start: { dateTime: '2026-05-12T12:30:00+01:00' },
            end: { dateTime: '2026-05-12T13:30:00+01:00' },
            etag: '"junk"',
            sequence: 0,
            iCalUID: 'should-be-dropped',
            attendees: [{ email: 'sarah@example.com', responseStatus: 'accepted' }],
          },
        ],
      }),
      stderr: '',
      code: 0,
    });
    const tool = createListEventsTool({ store: fakeStore(), uid: 'u', execFile: fakeExec });
    const r = await exec(tool, {
      timeMin: '2026-05-12T00:00:00Z',
      timeMax: '2026-05-13T00:00:00Z',
      calendarId: 'work@example.com',
    });
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toMatchObject({
      id: 'ev1',
      calendarId: 'work@example.com',
      summary: 'Lunch with Sarah',
      attendees: ['sarah@example.com'],
    });
    // Bloat fields don't survive projection.
    expect(r.events[0]).not.toHaveProperty('etag');
    expect(r.events[0]).not.toHaveProperty('iCalUID');
  });

  it('propagates errors from runGws', async () => {
    const fakeExec: ExecFileLike = async () => ({
      stdout: JSON.stringify({ error: { code: 403, message: 'forbidden' } }),
      stderr: '',
      code: 1,
    });
    const tool = createListEventsTool({ store: fakeStore(), uid: 'u', execFile: fakeExec });
    const r = await exec(tool, { timeMin: 'a', timeMax: 'b' });
    expect(r).toMatchObject({ status: 'error', code: 'forbidden' });
  });
});
