import type { Event, Session } from '@google/adk';

export interface DaySummary {
  summary: string;
  summaryGeneratedAt: number;
}

export interface SessionSummaryStore {
  appName: string;
  getSession(params: { appName: string; userId: string; sessionId: string }): Promise<
    Session | null | undefined
  >;
  listSessions?(params: { appName: string; userId: string }): Promise<{ sessions: Session[] }>;
  saveSummary?(params: {
    appName: string;
    userId: string;
    sessionId: string;
    summary: string;
    summaryGeneratedAt: number;
  }): Promise<void>;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; value: DaySummary | null }>();

function key(uid: string, date: string): string {
  return `${uid}:${date}`;
}

function extractUtterances(events: Event[]): string[] {
  return events
    .flatMap((e) =>
      (e.content?.parts ?? []).flatMap((p) => {
        if (typeof p.text !== 'string') return [] as string[];
        const t = p.text.trim();
        if (!t || t === '__session_start__') return [] as string[];
        return [`${e.author === 'user' ? 'User' : 'Coach'}: ${t}`];
      }),
    )
    .slice(-24);
}

function summarizeFromEvents(events: Event[]): string {
  const lines = extractUtterances(events);
  if (lines.length === 0) return 'No meaningful conversation was captured for that day.';
  const joined = lines.join(' ');
  return joined.length > 520 ? `${joined.slice(0, 517)}...` : joined;
}

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function getOrGenerateSummary(
  store: SessionSummaryStore,
  uid: string,
  date: string,
): Promise<DaySummary | null> {
  if (!isIsoDate(date)) return null;
  const k = key(uid, date);
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const session = await store.getSession({ appName: store.appName, userId: uid, sessionId: date });
  if (!session) {
    cache.set(k, { at: Date.now(), value: null });
    return null;
  }
  const existing = session.state?.summary;
  const existingAt = session.state?.summaryGeneratedAt;
  if (typeof existing === 'string' && typeof existingAt === 'number') {
    const v = { summary: existing, summaryGeneratedAt: existingAt };
    cache.set(k, { at: Date.now(), value: v });
    return v;
  }

  const events = session.events ?? [];
  if (events.length === 0) {
    cache.set(k, { at: Date.now(), value: null });
    return null;
  }
  const summary = summarizeFromEvents(events);
  const summaryGeneratedAt = Date.now();
  if (store.saveSummary) {
    await store.saveSummary({
      appName: store.appName,
      userId: uid,
      sessionId: date,
      summary,
      summaryGeneratedAt,
    });
  }
  const v = { summary, summaryGeneratedAt };
  cache.set(k, { at: Date.now(), value: v });
  return v;
}

export async function getWeeklySummary(
  store: SessionSummaryStore,
  uid: string,
  todayDate: string,
): Promise<string | null> {
  const dates = Array.from({ length: 7 }, (_x, i) => shiftDate(todayDate, -(i + 1))).reverse();
  const items = await Promise.all(dates.map((d) => getOrGenerateSummary(store, uid, d)));
  if (items.some((x) => !x)) return null;
  return items
    .map((item, i) => `${dates[i]}: ${item?.summary}`)
    .join(' ')
    .slice(0, 900);
}
