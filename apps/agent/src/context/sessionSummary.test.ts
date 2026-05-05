import type { Event, Session } from '@google/adk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type SessionSummaryStore,
  type Summarizer,
  createSessionSummaryClient,
  transcriptFromEvents,
} from './sessionSummary.js';

function mkSession(id: string, events: Event[]): Session {
  return {
    id,
    appName: 'lifecoach',
    userId: 'u1',
    state: {},
    events,
    lastUpdateTime: 0,
  } as Session;
}

function mkConversation(...turns: Array<['user' | 'lifecoach', string]>): Event[] {
  return turns.map(([author, text]) => ({ author, content: { parts: [{ text }] } }) as Event);
}

function mkStore(initial: Map<string, Session> = new Map()): SessionSummaryStore & {
  saved: Array<{ sessionId: string; summary: string; generatedAt: number }>;
  sessions: Map<string, Session>;
} {
  const sessions = new Map(initial);
  const saved: Array<{ sessionId: string; summary: string; generatedAt: number }> = [];
  return {
    appName: 'lifecoach',
    sessions,
    saved,
    async getSession({ sessionId }) {
      return sessions.get(sessionId);
    },
    async saveSummary({ sessionId, summary, generatedAt }) {
      saved.push({ sessionId, summary, generatedAt });
      const s = sessions.get(sessionId);
      if (s) {
        s.state = { ...s.state, summary, summaryGeneratedAt: generatedAt };
      }
    },
  };
}

describe('transcriptFromEvents', () => {
  it('drops the synthetic kickoff and labels each turn', () => {
    const events = mkConversation(
      ['user', '__session_start__'],
      ['user', 'good morning'],
      ['lifecoach', 'Morning! What would you like to focus on?'],
    );
    expect(transcriptFromEvents(events)).toBe(
      'User: good morning\nCoach: Morning! What would you like to focus on?',
    );
  });

  it('drops the __continue__ retry sentinel from the transcript', () => {
    const events = mkConversation(
      ['user', 'tell me about Saturn'],
      ['lifecoach', ''],
      ['user', '__continue__'],
      ['lifecoach', 'Saturn has rings made of ice and rock.'],
    );
    expect(transcriptFromEvents(events)).toBe(
      'User: tell me about Saturn\nCoach: Saturn has rings made of ice and rock.',
    );
  });

  it('returns empty string for missing/empty events', () => {
    expect(transcriptFromEvents(undefined)).toBe('');
    expect(transcriptFromEvents([])).toBe('');
  });
});

describe('createSessionSummaryClient.getYesterday', () => {
  let summarizer: Summarizer;
  let summarizerCalls: string[];

  beforeEach(() => {
    summarizerCalls = [];
    summarizer = vi.fn(async (transcript: string) => {
      summarizerCalls.push(transcript);
      return 'A clean one-paragraph summary of the day.';
    });
  });

  it('generates and persists a summary when none exists yet', async () => {
    const store = mkStore(
      new Map([
        [
          '2026-04-30',
          mkSession(
            '2026-04-30',
            mkConversation(
              ['user', 'I had a tough day yesterday and need to talk it through'],
              ['lifecoach', 'I am here. What was hardest?'],
            ),
          ),
        ],
      ]),
    );
    const client = createSessionSummaryClient({ store, summarizer, now: () => 1000 });
    const result = await client.getYesterday({ uid: 'u1', todayDateLocal: '2026-05-01' });
    expect(result).toBe('A clean one-paragraph summary of the day.');
    expect(store.saved).toHaveLength(1);
    expect(store.saved[0]).toMatchObject({
      sessionId: '2026-04-30',
      summary: 'A clean one-paragraph summary of the day.',
      generatedAt: 1000,
    });
    expect(summarizerCalls).toHaveLength(1);
    expect(summarizerCalls[0]).toMatch(/tough day/);
  });

  it('returns the persisted summary without calling the summarizer when state.summary exists', async () => {
    const session = mkSession('2026-04-30', mkConversation(['user', 'hi'], ['lifecoach', 'hey']));
    session.state = { summary: 'Already-stored summary.', summaryGeneratedAt: 500 };
    const store = mkStore(new Map([['2026-04-30', session]]));
    const client = createSessionSummaryClient({ store, summarizer, now: () => 1000 });
    const result = await client.getYesterday({ uid: 'u1', todayDateLocal: '2026-05-01' });
    expect(result).toBe('Already-stored summary.');
    expect(summarizerCalls).toHaveLength(0);
    expect(store.saved).toHaveLength(0);
  });

  it('returns null when yesterday has no session at all', async () => {
    const store = mkStore();
    const client = createSessionSummaryClient({ store, summarizer });
    const result = await client.getYesterday({ uid: 'u1', todayDateLocal: '2026-05-01' });
    expect(result).toBeNull();
    expect(summarizerCalls).toHaveLength(0);
  });

  it('returns null when yesterday only has the kickoff (no real conversation)', async () => {
    const store = mkStore(
      new Map([
        ['2026-04-30', mkSession('2026-04-30', mkConversation(['user', '__session_start__']))],
      ]),
    );
    const client = createSessionSummaryClient({ store, summarizer });
    const result = await client.getYesterday({ uid: 'u1', todayDateLocal: '2026-05-01' });
    expect(result).toBeNull();
    expect(summarizerCalls).toHaveLength(0);
    expect(store.saved).toHaveLength(0);
  });

  it('returns null when the summarizer fails (does not crash the turn)', async () => {
    const failing: Summarizer = vi.fn(async () => {
      throw new Error('flash-lite went sideways');
    });
    const store = mkStore(
      new Map([
        [
          '2026-04-30',
          mkSession(
            '2026-04-30',
            mkConversation(
              ['user', 'a long enough message to clear the threshold for summarisation'],
              ['lifecoach', 'and a coach reply'],
            ),
          ),
        ],
      ]),
    );
    const client = createSessionSummaryClient({ store, summarizer: failing });
    const result = await client.getYesterday({ uid: 'u1', todayDateLocal: '2026-05-01' });
    expect(result).toBeNull();
    expect(store.saved).toHaveLength(0);
  });

  it('caches within the TTL window so repeat calls do not re-summarize', async () => {
    const store = mkStore(
      new Map([
        [
          '2026-04-30',
          mkSession(
            '2026-04-30',
            mkConversation(
              ['user', 'this conversation is real and long enough to summarise properly'],
              ['lifecoach', 'reply'],
            ),
          ),
        ],
      ]),
    );
    const client = createSessionSummaryClient({ store, summarizer, now: () => 1000 });
    await client.getYesterday({ uid: 'u1', todayDateLocal: '2026-05-01' });
    await client.getYesterday({ uid: 'u1', todayDateLocal: '2026-05-01' });
    await client.getYesterday({ uid: 'u1', todayDateLocal: '2026-05-01' });
    expect(summarizerCalls).toHaveLength(1);
  });

  it('returns null on malformed today date string', async () => {
    const store = mkStore();
    const client = createSessionSummaryClient({ store, summarizer });
    expect(await client.getYesterday({ uid: 'u1', todayDateLocal: 'not-a-date' })).toBeNull();
  });
});

describe('createSessionSummaryClient.getWeek', () => {
  it('joins the last 7 day-summaries chronologically when at least 2 are available', async () => {
    // 2026-04-25..2026-04-30 (6 days) all have stored summaries; 2026-04-24 is missing.
    const sessions = new Map<string, Session>();
    for (const [date, summary] of [
      ['2026-04-25', 'monday: focus on sleep'],
      ['2026-04-26', 'tuesday: rough commute'],
      ['2026-04-27', 'wednesday: gym went well'],
      ['2026-04-28', 'thursday: caught up on email'],
      ['2026-04-29', 'friday: dinner with family'],
      ['2026-04-30', 'saturday: long walk in the park'],
    ]) {
      const s = mkSession(date as string, mkConversation(['user', 'hi'], ['lifecoach', 'hey']));
      s.state = { summary: summary as string, summaryGeneratedAt: 1 };
      sessions.set(date as string, s);
    }
    const store = mkStore(sessions);
    const summarizer: Summarizer = vi.fn(async () => 'fresh');
    const client = createSessionSummaryClient({ store, summarizer });
    const week = await client.getWeek({ uid: 'u1', todayDateLocal: '2026-05-01' });
    expect(week).not.toBeNull();
    // Chronological: oldest day first.
    expect(week).toMatch(/2026-04-25: monday: focus on sleep/);
    expect(week).toMatch(/2026-04-30: saturday: long walk in the park/);
    // The 2026-04-24 gap is silently skipped — not a structural problem.
    const lines = week?.split('\n') ?? [];
    expect(lines).toHaveLength(6);
  });

  it('returns null when fewer than 2 days have summaries (not yet a "week")', async () => {
    const session = mkSession('2026-04-30', mkConversation(['user', 'hi'], ['lifecoach', 'hey']));
    session.state = { summary: 'one solitary day', summaryGeneratedAt: 1 };
    const store = mkStore(new Map([['2026-04-30', session]]));
    const client = createSessionSummaryClient({ store, summarizer: vi.fn(async () => null) });
    const week = await client.getWeek({ uid: 'u1', todayDateLocal: '2026-05-01' });
    expect(week).toBeNull();
  });
});
