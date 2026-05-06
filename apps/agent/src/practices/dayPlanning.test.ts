import { describe, expect, it } from 'vitest';
import type { InstructionContext } from '../prompt/buildInstruction.js';
import { dayPlanning } from './dayPlanning.js';
import type { PracticeCtx } from './types.js';

const BASE_CTX: InstructionContext = {
  // 08:00 London (BST = UTC+1) on 2026-05-06 → in the morning window
  now: new Date('2026-05-06T07:00:00Z'),
  timezone: 'Europe/London',
  userState: 'google_linked',
  location: null,
  weather: null,
};

function ctx(overrides: Partial<PracticeCtx> = {}): PracticeCtx {
  return {
    ...BASE_CTX,
    practiceState: {},
    ...overrides,
  } as PracticeCtx;
}

describe('dayPlanning.directive — time gate', () => {
  it('emits in the morning window when not yet planned today', () => {
    const out = dayPlanning.directive?.(ctx());
    expect(out).not.toBeNull();
    expect(out).toMatch(/DAY_PLANNING/);
  });

  it('skips before 05:00 local', () => {
    // 03:00 London
    expect(dayPlanning.directive?.(ctx({ now: new Date('2026-05-06T02:00:00Z') }))).toBeNull();
  });

  it('skips at 11:00 local (window is 5–10 inclusive)', () => {
    // 11:00 London = 10:00 UTC summer time (BST = UTC+1)
    expect(dayPlanning.directive?.(ctx({ now: new Date('2026-05-06T10:00:00Z') }))).toBeNull();
  });

  it('emits at exactly 10:00 local (boundary held)', () => {
    // 10:00 London (BST) = 09:00 UTC
    const out = dayPlanning.directive?.(ctx({ now: new Date('2026-05-06T09:00:00Z') }));
    expect(out).not.toBeNull();
  });
});

describe('dayPlanning.directive — idempotency', () => {
  it('skips when last_planned_date matches today (local)', () => {
    const out = dayPlanning.directive?.(
      ctx({ practiceState: { last_planned_date: '2026-05-06' } }),
    );
    expect(out).toBeNull();
  });

  it('still emits when last_planned_date is yesterday', () => {
    const out = dayPlanning.directive?.(
      ctx({ practiceState: { last_planned_date: '2026-05-05' } }),
    );
    expect(out).not.toBeNull();
  });
});

describe('dayPlanning.directive — workspace arm vs light arm', () => {
  it('returns the workspace arm when userState is workspace_connected', () => {
    const out = dayPlanning.directive?.(ctx({ userState: 'workspace_connected' }));
    expect(out).toMatch(/Archive these/);
    expect(out).toMatch(/call_workspace/);
    expect(out).toMatch(/calendar\.events\.insert/);
  });

  it('returns the light arm when userState is google_linked (no workspace)', () => {
    const out = dayPlanning.directive?.(ctx({ userState: 'google_linked' }));
    expect(out).toMatch(/most important thing/);
    expect(out).not.toMatch(/call_workspace/);
    expect(out).not.toMatch(/Archive these/);
  });

  it('returns the light arm when userState is anonymous', () => {
    const out = dayPlanning.directive?.(ctx({ userState: 'anonymous' }));
    expect(out).not.toMatch(/call_workspace/);
  });
});

describe('dayPlanning.directive — stamps the idempotency key', () => {
  it('instructs the agent to update the last_planned_date path with today', () => {
    const out = dayPlanning.directive?.(ctx());
    expect(out).toMatch(/practices\.day_planning\.last_planned_date/);
    expect(out).toMatch(/2026-05-06/);
  });
});

describe('dayPlanning metadata', () => {
  it('uses a stable id matching the user-yaml path', () => {
    expect(dayPlanning.id).toBe('day_planning');
  });

  it('exposes a user-facing label and description', () => {
    expect(dayPlanning.label).toBe('Plan the day');
    expect(dayPlanning.description).toMatch(/priorities/i);
  });

  it('exposes an offer hint for when the practice is OFF', () => {
    expect(dayPlanning.offerHint).toBeDefined();
    expect(dayPlanning.offerHint).toMatch(/inbox|focus|day/i);
  });
});
