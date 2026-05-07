import { FunctionTool } from '@google/adk';
import type { EventProjection } from '@lifecoach/shared-types';
import { z } from 'zod';
import type { WorkspaceTokensStore } from '../../../storage/workspaceTokens.js';
import type { ExecFileLike } from '../gwsExec.js';
import { projectCalendarEvent } from '../projections/calendarEvent.js';
import { type RunGwsLogEvent, runGws } from '../runGws.js';

/**
 * `list_events` — Google Calendar events in a time window. Each event
 * passes through `projectCalendarEvent` to drop the API bloat.
 */

export const LIST_EVENTS_TOOL_NAME = 'list_events';

export interface CreateListEventsToolDeps {
  store: WorkspaceTokensStore;
  uid: string;
  execFile?: ExecFileLike;
  log?: (event: RunGwsLogEvent) => void;
}

export type ListEventsResult =
  | { status: 'ok'; events: EventProjection[]; truncated?: boolean }
  | { status: 'error'; code: string; message: string };

const parameters = z.object({
  timeMin: z.string().min(1).describe('RFC3339 lower bound — e.g. "2026-05-12T00:00:00+01:00".'),
  timeMax: z
    .string()
    .min(1)
    .describe('RFC3339 upper bound (exclusive). Pair with timeMin to define a window.'),
  calendarId: z.string().optional().describe('Calendar id. Default "primary".'),
});

interface EventsListResponse {
  items?: unknown[];
}

export function createListEventsTool(deps: CreateListEventsToolDeps): FunctionTool {
  const { store, uid, execFile, log } = deps;

  // biome-ignore lint/suspicious/noExplicitAny: zod nominal mismatch with ADK generics
  return new FunctionTool<any>({
    name: LIST_EVENTS_TOOL_NAME,
    description:
      'List Google Calendar events in [timeMin, timeMax). Returns projected event shapes (title, start/end, location, attendees, link). Read-only.',
    parameters,
    execute: async (input: unknown): Promise<ListEventsResult> => {
      const args = input as { timeMin: string; timeMax: string; calendarId?: string };
      const calendarId = args.calendarId ?? 'primary';

      const result = await runGws({
        store,
        uid,
        toolName: LIST_EVENTS_TOOL_NAME,
        service: 'calendar',
        resource: 'events',
        method: 'list',
        params: {
          calendarId,
          timeMin: args.timeMin,
          timeMax: args.timeMax,
          singleEvents: true,
          orderBy: 'startTime',
        },
        execFile,
        log,
      });
      if (result.status === 'error') {
        return { status: 'error', code: result.code, message: result.message };
      }
      const body = (result.body as EventsListResponse | null) ?? {};
      const events = (body.items ?? []).map((raw) =>
        // biome-ignore lint/suspicious/noExplicitAny: gws returns dynamic JSON
        projectCalendarEvent(raw as any, calendarId),
      );
      return result.truncated
        ? { status: 'ok', events, truncated: true }
        : { status: 'ok', events };
    },
  });
}
