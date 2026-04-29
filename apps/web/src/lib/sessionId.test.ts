import { describe, expect, it } from 'vitest';
import { dateLocal, sessionIdFor, sessionIdForToday, todayDateLocal } from './sessionId';

describe('dateLocal', () => {
  it('returns YYYY-MM-DD for a known date', () => {
    // Construct date via local components so the test isn't tz-dependent.
    const d = new Date(2026, 3, 29); // April 29 2026 in local tz
    expect(dateLocal(d)).toBe('2026-04-29');
  });

  it('zero-pads month and day', () => {
    const d = new Date(2026, 0, 5); // Jan 5
    expect(dateLocal(d)).toBe('2026-01-05');
  });
});

describe('todayDateLocal', () => {
  it('matches dateLocal(new Date())', () => {
    expect(todayDateLocal()).toBe(dateLocal(new Date()));
  });

  it('matches the YYYY-MM-DD shape', () => {
    expect(todayDateLocal()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('sessionIdFor', () => {
  it('joins uid and date with a dash', () => {
    expect(sessionIdFor('alice', '2026-04-29')).toBe('alice-2026-04-29');
  });

  it('throws on empty uid', () => {
    expect(() => sessionIdFor('', '2026-04-29')).toThrow(/uid is required/);
  });

  it('throws on a malformed date', () => {
    expect(() => sessionIdFor('alice', '4/29/2026')).toThrow(/YYYY-MM-DD/);
    expect(() => sessionIdFor('alice', '2026-4-29')).toThrow(/YYYY-MM-DD/);
    expect(() => sessionIdFor('alice', '')).toThrow(/YYYY-MM-DD/);
  });

  it('two callers with the same inputs get the same id', () => {
    expect(sessionIdFor('alice', '2026-04-29')).toBe(sessionIdFor('alice', '2026-04-29'));
  });

  it('different days yield different ids', () => {
    expect(sessionIdFor('alice', '2026-04-29')).not.toBe(sessionIdFor('alice', '2026-04-30'));
  });

  it('different uids yield different ids', () => {
    expect(sessionIdFor('alice', '2026-04-29')).not.toBe(sessionIdFor('bob', '2026-04-29'));
  });
});

describe('sessionIdForToday', () => {
  it('equals sessionIdFor(uid, todayDateLocal())', () => {
    expect(sessionIdForToday('alice')).toBe(sessionIdFor('alice', todayDateLocal()));
  });
});
