import type { Event, Session } from '@google/adk';
import { describe, expect, it } from 'vitest';
import {
  type SessionSummaryStore,
  getOrGenerateSummary,
  getWeeklySummary,
} from './sessionSummary.js';

function mkSession(id: string, text: string): Session {
  return {
    id,
    appName: 'lifecoach',
    userId: 'u1',
    state: {},
    events: [
      { author: 'user', content: { parts: [{ text }] } },
      { author: 'lifecoach', content: { parts: [{ text: 'Got it.' }] } },
    ] as Event[],
    lastUpdateTime: 0,
  } as Session;
}

describe('sessionSummary', () => {
  it('generates and persists a missing summary', async () => {
    const saved: string[] = [];
    const store: SessionSummaryStore = {
      appName: 'lifecoach',
      getSession: async () => mkSession('2026-04-30', 'I had a tough day yesterday'),
      saveSummary: async (p) => {
        saved.push(p.summary);
      },
    };
    const s = await getOrGenerateSummary(store, 'u1', '2026-04-30');
    expect(s?.summary).toMatch(/tough day/);
    expect(saved).toHaveLength(1);
  });

  it('builds a weekly summary only when all 7 previous days have summaries', async () => {
    const sessions = new Map<string, Session>();
    for (let i = 1; i <= 7; i++) {
      const day = `2026-04-${String(30 - i).padStart(2, '0')}`;
      sessions.set(day, mkSession(day, `day-${i}`));
    }
    const store: SessionSummaryStore = {
      appName: 'lifecoach',
      getSession: async ({ sessionId }) => sessions.get(sessionId) ?? null,
    };
    const week = await getWeeklySummary(store, 'u1', '2026-05-01');
    expect(week).toMatch(/2026-04-30/);
    expect(week).toMatch(/day-1/);
  });
});
