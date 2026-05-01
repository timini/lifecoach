import type { Event } from '@google/adk';

export interface SessionSummaryProvider {
  getYesterdayAndWeek(params: {
    uid: string;
    sessionId: string;
    timezone: string | null;
    now: Date;
  }): Promise<{ yesterday: string | null; week: string | null }>;
}

function extractUserLines(events: Event[] | undefined): string[] {
  const out: string[] = [];
  for (const ev of events ?? []) {
    if (ev.author !== 'user') continue;
    const text = (ev.content?.parts ?? [])
      .map((p) => (typeof p.text === 'string' ? p.text : ''))
      .join(' ')
      .trim();
    if (!text || text === '__session_start__') continue;
    out.push(text.replace(/\s+/g, ' '));
  }
  return out;
}

function summarizeLines(lines: string[]): string | null {
  if (lines.length === 0) return null;
  const joined = lines.join(' ');
  return joined.length > 420 ? `${joined.slice(0, 417)}...` : joined;
}

export function buildWeekSummary(daySummaries: string[]): string | null {
  const compact = daySummaries.filter(Boolean);
  if (compact.length < 2) return null;
  return summarizeLines(compact.map((s, i) => `Day ${i + 1}: ${s}`));
}

export { extractUserLines, summarizeLines };
