/**
 * Yesterday + 7-day rolling summary context for the chat prompt.
 *
 * Issue #10's design: each calendar-day session lives at
 *   apps/lifecoach/users/{uid}/sessions/{YYYY-MM-DD}
 * On every turn we want the agent to see (a) yesterday's one-paragraph
 * summary and (b) a 7-day rolling digest, without re-asking the user what
 * they were working on.
 *
 * Generation strategy:
 *   - Lazy. When today's turn fires and yesterday's session has events but
 *     no summary on `state.summary`, we run a single Gemini Flash Lite call,
 *     persist the result, and return it. Subsequent turns hit the cached
 *     copy and never call the LLM again.
 *   - Weekly summary is computed on the fly from the last 7 day-summaries
 *     (issue #10 says "pick the cheaper option" — no extra Firestore doc).
 *   - 5-minute in-memory cache, matching the other context providers (see
 *     weather.ts, places.ts).
 *
 * The Summarizer interface is injected so unit tests can drop in a
 * deterministic stub. Production wiring uses `@google/genai` against
 * `gemini-flash-lite-latest` (cheap + fast for one-paragraph summarisation).
 */

import type { Event, Session } from '@google/adk';

const CACHE_TTL_MS = 5 * 60_000;
const MIN_TRANSCRIPT_CHARS = 40;
const MAX_TRANSCRIPT_CHARS = 12_000;
const SUMMARY_MAX_CHARS = 600;
const WEEK_SUMMARY_MAX_CHARS = 1_200;

export interface DaySummary {
  /** One paragraph, ~80 words. */
  summary: string;
  /** Epoch ms — lets us decide whether to regenerate. Currently we never do
   *  (events written after the summary are picked up next-day) but the field
   *  is still recorded for forward compatibility. */
  generatedAt: number;
}

export interface SessionSummaryStore {
  appName: string;
  getSession(params: {
    appName: string;
    userId: string;
    sessionId: string;
  }): Promise<Session | null | undefined>;
  /** Persist `state.summary` + `state.summaryGeneratedAt` on the session doc. */
  saveSummary(params: {
    appName: string;
    userId: string;
    sessionId: string;
    summary: string;
    generatedAt: number;
  }): Promise<void>;
}

/** Pluggable LLM call. Returns the one-paragraph summary, or null if it
 *  declines / errors. Production = gemini-flash-lite-latest via @google/genai. */
export type Summarizer = (transcript: string) => Promise<string | null>;

export interface SessionSummaryClient {
  /**
   * One-paragraph summary of yesterday's chat in the user's local timezone.
   * Returns null if yesterday had no real activity, the session is missing,
   * or the summarizer fails.
   */
  getYesterday(params: { uid: string; todayDateLocal: string }): Promise<string | null>;
  /**
   * Rolling 7-day digest: a labelled list "DATE: summary" for each of the
   * 7 prior days that has a summary. Returns null if fewer than 2 days have
   * any summary (< 2 isn't a "week" worth of context — the agent should
   * fall back to YESTERDAY alone, or nothing).
   */
  getWeek(params: { uid: string; todayDateLocal: string }): Promise<string | null>;
}

/**
 * Build a transcript for the Summarizer. Drops the synthetic kickoff
 * (`__session_start__`), trims to MAX_TRANSCRIPT_CHARS to keep cost bounded,
 * and labels each turn so the LLM knows who said what.
 */
export function transcriptFromEvents(events: Event[] | undefined): string {
  const lines: string[] = [];
  for (const ev of events ?? []) {
    const parts = ev.content?.parts ?? [];
    const text = parts
      .map((p) => (typeof p.text === 'string' ? p.text : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text || text === '__session_start__' || text === '__continue__') continue;
    const role = ev.author === 'user' ? 'User' : 'Coach';
    lines.push(`${role}: ${text}`);
  }
  const joined = lines.join('\n');
  return joined.length > MAX_TRANSCRIPT_CHARS ? joined.slice(0, MAX_TRANSCRIPT_CHARS) : joined;
}

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/**
 * Day-shift in UTC. We pass *local* date strings in (YYYY-MM-DD already
 * resolved to the user's tz) so straight UTC arithmetic over those keys is
 * the right thing — adding a tz here would double-shift and produce wrong
 * keys at midnight boundaries.
 */
function shiftDate(dateLocal: string, days: number): string {
  const d = new Date(`${dateLocal}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

interface CacheEntry {
  at: number;
  value: DaySummary | null;
}

export interface CreateSessionSummaryClientDeps {
  store: SessionSummaryStore;
  summarizer: Summarizer;
  now?: () => number;
  ttlMs?: number;
}

export function createSessionSummaryClient(
  deps: CreateSessionSummaryClientDeps,
): SessionSummaryClient {
  const now = deps.now ?? (() => Date.now());
  const ttl = deps.ttlMs ?? CACHE_TTL_MS;
  const cache = new Map<string, CacheEntry>();

  function cacheKey(uid: string, dateLocal: string): string {
    return `${uid}:${dateLocal}`;
  }

  /** Returns the day's summary, generating + persisting if we have events
   *  but no stored summary yet. */
  async function getOrGenerate(uid: string, dateLocal: string): Promise<DaySummary | null> {
    if (!isIsoDate(dateLocal)) return null;
    const key = cacheKey(uid, dateLocal);
    const hit = cache.get(key);
    if (hit && now() - hit.at < ttl) return hit.value;

    let session: Session | null | undefined;
    try {
      session = await deps.store.getSession({
        appName: deps.store.appName,
        userId: uid,
        sessionId: dateLocal,
      });
    } catch {
      session = null;
    }
    if (!session) {
      cache.set(key, { at: now(), value: null });
      return null;
    }

    const stateSummary = session.state?.summary;
    const stateGeneratedAt = session.state?.summaryGeneratedAt;
    if (typeof stateSummary === 'string' && typeof stateGeneratedAt === 'number') {
      const v: DaySummary = { summary: stateSummary, generatedAt: stateGeneratedAt };
      cache.set(key, { at: now(), value: v });
      return v;
    }

    const transcript = transcriptFromEvents(session.events);
    if (transcript.length < MIN_TRANSCRIPT_CHARS) {
      // Empty / kickoff-only days don't warrant a summary or LLM call.
      cache.set(key, { at: now(), value: null });
      return null;
    }

    let summary: string | null;
    try {
      summary = await deps.summarizer(transcript);
    } catch {
      summary = null;
    }
    if (!summary || summary.trim().length === 0) {
      cache.set(key, { at: now(), value: null });
      return null;
    }
    const trimmed =
      summary.length > SUMMARY_MAX_CHARS
        ? `${summary.slice(0, SUMMARY_MAX_CHARS - 1).trimEnd()}…`
        : summary.trim();
    const v: DaySummary = { summary: trimmed, generatedAt: now() };
    try {
      await deps.store.saveSummary({
        appName: deps.store.appName,
        userId: uid,
        sessionId: dateLocal,
        summary: v.summary,
        generatedAt: v.generatedAt,
      });
    } catch {
      // Persistence failure shouldn't block the turn — we still have the
      // value in-memory for the cache TTL window. Tomorrow's turn will
      // retry the generation on cache miss + missing state.
    }
    cache.set(key, { at: now(), value: v });
    return v;
  }

  async function getYesterday(params: {
    uid: string;
    todayDateLocal: string;
  }): Promise<string | null> {
    if (!isIsoDate(params.todayDateLocal)) return null;
    const yesterday = shiftDate(params.todayDateLocal, -1);
    const v = await getOrGenerate(params.uid, yesterday);
    return v?.summary ?? null;
  }

  async function getWeek(params: {
    uid: string;
    todayDateLocal: string;
  }): Promise<string | null> {
    if (!isIsoDate(params.todayDateLocal)) return null;
    // Walk from oldest (-7) to most-recent (-1) so the digest reads
    // chronologically. Resolve in parallel; failures degrade to skipped days.
    const dates = Array.from({ length: 7 }, (_, i) => shiftDate(params.todayDateLocal, -(7 - i)));
    const items = await Promise.all(
      dates.map((d) => getOrGenerate(params.uid, d).catch(() => null)),
    );
    const lines = items
      .map((item, i) => (item ? `${dates[i]}: ${item.summary}` : null))
      .filter((x): x is string => x !== null);
    if (lines.length < 2) return null;
    const joined = lines.join('\n');
    return joined.length > WEEK_SUMMARY_MAX_CHARS
      ? `${joined.slice(0, WEEK_SUMMARY_MAX_CHARS - 1).trimEnd()}…`
      : joined;
  }

  return { getYesterday, getWeek };
}
