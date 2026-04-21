import { describe, expect, it } from 'vitest';
import { GOAL_STATUSES, GoalUpdateSchema } from './goalUpdate.js';

describe('GoalUpdateSchema', () => {
  it('parses a minimal entry (no note)', () => {
    const parsed = GoalUpdateSchema.parse({
      timestamp: '2026-04-21T09:00:00.000Z',
      goal: 'Running',
      status: 'progress',
    });
    expect(parsed.note).toBeUndefined();
    expect(parsed.goal).toBe('Running');
  });

  it('parses a full entry with note', () => {
    const parsed = GoalUpdateSchema.parse({
      timestamp: '2026-04-21T09:00:00.000Z',
      goal: 'Running',
      status: 'completed',
      note: 'First 10k!',
    });
    expect(parsed.note).toBe('First 10k!');
  });

  it('rejects non-ISO timestamp', () => {
    expect(() =>
      GoalUpdateSchema.parse({ timestamp: 'yesterday', goal: 'x', status: 'started' }),
    ).toThrow();
  });

  it('rejects unknown status', () => {
    expect(() =>
      GoalUpdateSchema.parse({
        timestamp: '2026-04-21T09:00:00.000Z',
        goal: 'x',
        status: 'frozen',
      }),
    ).toThrow();
  });

  it('rejects unknown top-level keys', () => {
    expect(() =>
      GoalUpdateSchema.parse({
        timestamp: '2026-04-21T09:00:00.000Z',
        goal: 'x',
        status: 'started',
        extra: 1,
      }),
    ).toThrow();
  });

  it('exposes the full list of legal statuses', () => {
    expect(GOAL_STATUSES).toEqual(['started', 'progress', 'completed', 'paused', 'abandoned']);
  });
});
