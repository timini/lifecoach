/**
 * Pre-fetched calendar density (today + tomorrow event counts) injected into
 * the system prompt every turn. The LLM gets narrative awareness of "you have
 * 8 meetings tomorrow" without having to call call_workspace — saves a turn
 * per chat for the common "anything on today?" / "busy tomorrow?" prompts.
 *
 * Auth: reuses workspaceTokensStore.getValidAccessToken(uid). Token never
 * appears in argv — passed via env to the gws subprocess (same pattern as
 * call_workspace).
 *
 * Caching: per (uid, tz) for 5 min. Calendars shift fast and the data is
 * cheap to refresh, but caching across rapid successive turns is the win.
 *
 * Failure mode: any error → return null. The format helper omits the block
 * when null. Never blocks a turn.
 */

import { ScopeRequiredError, type WorkspaceTokensStore } from '../storage/workspaceTokens.js';
import { type ExecFileLike, defaultExecFile } from '../tools/callWorkspace.js';

export interface CalendarDensitySummary {
  today: {
    count: number;
    /** HH:MM in user's tz; null when no events with explicit start times. */
    firstStart: string | null;
    /** HH:MM in user's tz; null when no events with explicit end times. */
    lastEnd: string | null;
    /** HH:MM of next not-yet-started event today, or null if all are past. */
    nextStart: string | null;
  };
  tomorrow: {
    count: number;
    firstStart: string | null;
    lastEnd: string | null;
  };
}

export interface CalendarDensityClient {
  get(params: {
    uid: string;
    timezone: string;
    now: Date;
  }): Promise<CalendarDensitySummary | null>;
}

interface CacheEntry {
  at: number;
  /** The tz-local "today" date this entry was computed for — invalidates on day rollover. */
  todayDate: string;
  value: CalendarDensitySummary | null;
}

const TTL_MS = 5 * 60_000;
const TIMEOUT_MS = 10_000;

interface GoogleEventTime {
  dateTime?: string;
  date?: string;
}

interface GoogleEvent {
  start?: GoogleEventTime;
  end?: GoogleEventTime;
}

interface GwsListResponse {
  items?: GoogleEvent[];
}

export interface CreateCalendarDensityClientDeps {
  store: WorkspaceTokensStore;
  exec?: ExecFileLike;
  ttlMs?: number;
  gwsPath?: string;
  timeoutMs?: number;
}

export function createCalendarDensityClient(
  deps: CreateCalendarDensityClientDeps,
): CalendarDensityClient {
  const { store } = deps;
  const exec = deps.exec ?? defaultExecFile;
  const ttl = deps.ttlMs ?? TTL_MS;
  const gwsPath = deps.gwsPath ?? 'gws';
  const timeoutMs = deps.timeoutMs ?? TIMEOUT_MS;
  const cache = new Map<string, CacheEntry>();

  return {
    async get({ uid, timezone, now }) {
      const todayDate = dateInTz(now, timezone);
      const key = `${uid}:${timezone}`;
      const hit = cache.get(key);
      if (hit && hit.todayDate === todayDate && Date.now() - hit.at < ttl) {
        return hit.value;
      }

      let token: string;
      try {
        token = await store.getValidAccessToken(uid);
      } catch (err) {
        if (err instanceof ScopeRequiredError) {
          // No valid token. Don't cache — state machine will drop us out of
          // workspace_connected next turn and we'll stop being called.
          return null;
        }
        return null;
      }

      // Wide UTC window comfortably covers today + tomorrow in any timezone
      // (max ±14h offset). Keeps us off the timezone-arithmetic hot path.
      const timeMin = new Date(now.getTime() - 24 * 60 * 60_000).toISOString();
      const timeMax = new Date(now.getTime() + 48 * 60 * 60_000).toISOString();
      const params = JSON.stringify({
        calendarId: 'primary',
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 50,
      });

      let res: { stdout: string; stderr: string; code: number | null };
      try {
        res = await exec(gwsPath, ['calendar', 'events', 'list', '--params', params], {
          env: { ...process.env, GOOGLE_WORKSPACE_CLI_TOKEN: token },
          timeout: timeoutMs,
        });
      } catch {
        return null;
      }
      if (res.code !== 0) return null;

      let parsed: GwsListResponse;
      try {
        parsed = JSON.parse(res.stdout) as GwsListResponse;
      } catch {
        return null;
      }
      const items = parsed.items ?? [];

      const tomorrowDate = dateInTz(new Date(now.getTime() + 24 * 60 * 60_000), timezone);
      const summary = bucket(items, todayDate, tomorrowDate, timezone, now);
      cache.set(key, { at: Date.now(), todayDate, value: summary });
      return summary;
    },
  };
}

function bucket(
  items: GoogleEvent[],
  todayDate: string,
  tomorrowDate: string,
  tz: string,
  now: Date,
): CalendarDensitySummary {
  const todayStarts: Date[] = [];
  const todayEnds: Date[] = [];
  let todayCount = 0;
  const tomorrowStarts: Date[] = [];
  const tomorrowEnds: Date[] = [];
  let tomorrowCount = 0;

  for (const item of items) {
    const startStr = item.start?.dateTime ?? item.start?.date;
    if (!startStr) continue;
    // For all-day events, the date string is YYYY-MM-DD with no time. We
    // count them but don't fold them into the start/end time fields.
    const isAllDay = !item.start?.dateTime;
    const eventDay = isAllDay ? (startStr as string) : dateInTz(new Date(startStr), tz);
    if (eventDay === todayDate) {
      todayCount += 1;
      if (!isAllDay && item.start?.dateTime) todayStarts.push(new Date(item.start.dateTime));
      if (!isAllDay && item.end?.dateTime) todayEnds.push(new Date(item.end.dateTime));
    } else if (eventDay === tomorrowDate) {
      tomorrowCount += 1;
      if (!isAllDay && item.start?.dateTime) tomorrowStarts.push(new Date(item.start.dateTime));
      if (!isAllDay && item.end?.dateTime) tomorrowEnds.push(new Date(item.end.dateTime));
    }
  }

  const firstTodayStart = minDate(todayStarts);
  const lastTodayEnd = maxDate(todayEnds);
  const nextTodayStart = todayStarts
    .filter((d) => d.getTime() >= now.getTime())
    .sort((a, b) => a.getTime() - b.getTime())[0];

  return {
    today: {
      count: todayCount,
      firstStart: firstTodayStart ? timeInTz(firstTodayStart, tz) : null,
      lastEnd: lastTodayEnd ? timeInTz(lastTodayEnd, tz) : null,
      nextStart: nextTodayStart ? timeInTz(nextTodayStart, tz) : null,
    },
    tomorrow: {
      count: tomorrowCount,
      firstStart: minDate(tomorrowStarts) ? timeInTz(minDate(tomorrowStarts) as Date, tz) : null,
      lastEnd: maxDate(tomorrowEnds) ? timeInTz(maxDate(tomorrowEnds) as Date, tz) : null,
    },
  };
}

function minDate(ds: Date[]): Date | undefined {
  if (ds.length === 0) return undefined;
  return ds.reduce((a, b) => (a.getTime() <= b.getTime() ? a : b));
}

function maxDate(ds: Date[]): Date | undefined {
  if (ds.length === 0) return undefined;
  return ds.reduce((a, b) => (a.getTime() >= b.getTime() ? a : b));
}

function dateInTz(d: Date, tz: string): string {
  // en-CA gives YYYY-MM-DD reliably across all timezones.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function timeInTz(d: Date, tz: string): string {
  // sv-SE returns HH:MM in 24-hour format; en-GB has historical edge cases
  // around midnight (24:00 vs 00:00) — sv-SE doesn't.
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}
