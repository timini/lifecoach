import { FunctionTool } from '@google/adk';
import type { EventProjection } from '@lifecoach/shared-types';
import { z } from 'zod';
import type { WorkspaceTokensStore } from '../../../storage/workspaceTokens.js';
import type { ExecFileLike, GwsErrorCode } from '../gwsExec.js';
import { projectCalendarEvent } from '../projections/calendarEvent.js';
import { type RunGwsLogEvent, runGws } from '../runGws.js';

/**
 * `add_calendar_event` — single-step calendar.events.insert. Defaults
 * `end` to start + 30 min if omitted; defaults calendarId to "primary".
 */

export const ADD_CALENDAR_EVENT_TOOL_NAME = 'add_calendar_event';
const DEFAULT_DURATION_MS = 30 * 60_000;

export interface CreateAddCalendarEventToolDeps {
  store: WorkspaceTokensStore;
  uid: string;
  execFile?: ExecFileLike;
  log?: (event: RunGwsLogEvent) => void;
}

export type AddCalendarEventResult =
  | { status: 'ok'; event: EventProjection }
  | { status: 'error'; code: GwsErrorCode; message: string };

const parameters = z.object({
  summary: z.string().min(1).describe('Event title — what shows up on the calendar.'),
  start: z
    .string()
    .min(1)
    .describe(
      'RFC3339 start timestamp with timezone offset (e.g. "2026-05-12T18:00:00+01:00"), or YYYY-MM-DD for an all-day event.',
    ),
  end: z
    .string()
    .optional()
    .describe('RFC3339 end (or YYYY-MM-DD all-day). Default = start + 30 minutes.'),
  location: z.string().optional().describe('Optional event location.'),
  description: z.string().optional().describe('Optional event description / notes.'),
  calendarId: z.string().optional().describe('Calendar id. Default "primary".'),
});

interface RawInsertedEvent {
  id?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  location?: string;
  htmlLink?: string;
  status?: string;
  description?: string;
}

export function createAddCalendarEventTool(deps: CreateAddCalendarEventToolDeps): FunctionTool {
  const { store, uid, execFile, log } = deps;

  // biome-ignore lint/suspicious/noExplicitAny: zod nominal mismatch with ADK generics
  return new FunctionTool<any>({
    name: ADD_CALENDAR_EVENT_TOOL_NAME,
    description:
      "Add a single event to the user's Google Calendar. Use after the user confirms (e.g. via ask_single_choice_question). Returns the created event.",
    parameters,
    execute: async (input: unknown): Promise<AddCalendarEventResult> => {
      const args = input as {
        summary: string;
        start: string;
        end?: string;
        location?: string;
        description?: string;
        calendarId?: string;
      };
      const calendarId = args.calendarId ?? 'primary';
      const isAllDay = /^\d{4}-\d{2}-\d{2}$/.test(args.start);

      const startBlock = isAllDay ? { date: args.start } : { dateTime: args.start };
      const endBlock = args.end
        ? isAllDay
          ? { date: args.end }
          : { dateTime: args.end }
        : isAllDay
          ? { date: args.start }
          : { dateTime: addMs(args.start, DEFAULT_DURATION_MS) };

      const requestBody: Record<string, unknown> = {
        summary: args.summary,
        start: startBlock,
        end: endBlock,
      };
      if (args.location) requestBody.location = args.location;
      if (args.description) requestBody.description = args.description;

      const result = await runGws({
        store,
        uid,
        toolName: ADD_CALENDAR_EVENT_TOOL_NAME,
        service: 'calendar',
        resource: 'events',
        method: 'insert',
        params: { calendarId },
        body: requestBody,
        execFile,
        log,
      });
      if (result.status === 'error') {
        return { status: 'error', code: result.code, message: result.message };
      }
      const projection = projectCalendarEvent(
        ((result.body as RawInsertedEvent | null) ?? {}) as RawInsertedEvent,
        calendarId,
      );
      return { status: 'ok', event: projection };
    },
  });
}

function addMs(rfc3339: string, ms: number): string {
  // Preserve the original timezone offset by manipulating ms only.
  const ts = Date.parse(rfc3339);
  if (Number.isNaN(ts)) return rfc3339;
  const tzMatch = rfc3339.match(/([+-]\d{2}:\d{2}|Z)$/);
  const tz = tzMatch?.[1] ?? 'Z';
  const next = new Date(ts + ms);
  if (tz === 'Z') return next.toISOString();
  // Reconstruct the offset-bearing form by computing the offset in minutes.
  const sign = tz.startsWith('-') ? -1 : 1;
  const parts = tz.replace(/[+-]/, '').split(':');
  const hh = Number(parts[0] ?? '0');
  const mm = Number(parts[1] ?? '0');
  const offsetMinutes = sign * (hh * 60 + mm);
  const local = new Date(next.getTime() + offsetMinutes * 60_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}${tz}`;
}
