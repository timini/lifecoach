import { describe, expect, it } from 'vitest';
import { DailyFlowMachine, type DailyFlowState, policyForDailyFlow } from './DailyFlowMachine.js';

function fromInput(
  partial: Partial<{ localHour: number; hasInteractedToday: boolean; lunchEaten: boolean }> = {},
): DailyFlowState {
  return DailyFlowMachine.from({
    localHour: partial.localHour ?? 9,
    hasInteractedToday: partial.hasInteractedToday ?? false,
    lunchEaten: partial.lunchEaten ?? false,
  }).current();
}

describe('DailyFlowMachine.from — time windows', () => {
  it('5:00 with no interaction → morning_greeting', () => {
    expect(fromInput({ localHour: 5, hasInteractedToday: false })).toBe('morning_greeting');
  });

  it('10:59 with interaction → morning', () => {
    expect(fromInput({ localHour: 10, hasInteractedToday: true })).toBe('morning');
  });

  it('11:00 → lunch (no eaten flag)', () => {
    expect(fromInput({ localHour: 11, lunchEaten: false })).toBe('lunch');
  });

  it('13:59 with eaten flag → post_lunch', () => {
    expect(fromInput({ localHour: 13, lunchEaten: true })).toBe('post_lunch');
  });

  it('14:30 still nudges lunch when not eaten', () => {
    expect(fromInput({ localHour: 14, lunchEaten: false })).toBe('lunch');
  });

  it('14:30 with eaten → post_lunch', () => {
    expect(fromInput({ localHour: 14, lunchEaten: true })).toBe('post_lunch');
  });

  it('16:59 → post_lunch regardless of eaten flag', () => {
    expect(fromInput({ localHour: 16, lunchEaten: false })).toBe('post_lunch');
    expect(fromInput({ localHour: 16, lunchEaten: true })).toBe('post_lunch');
  });

  it('17:00 → evening', () => {
    expect(fromInput({ localHour: 17 })).toBe('evening');
  });

  it('20:59 → evening', () => {
    expect(fromInput({ localHour: 20 })).toBe('evening');
  });

  it('21:00 → concluding', () => {
    expect(fromInput({ localHour: 21 })).toBe('concluding');
  });

  it('1:00 (early morning before "day starts") → concluding', () => {
    expect(fromInput({ localHour: 1 })).toBe('concluding');
  });

  it('4:59 → concluding (still pre-morning)', () => {
    expect(fromInput({ localHour: 4 })).toBe('concluding');
  });
});

describe('DailyFlowMachine.from — first-of-day override in morning', () => {
  it('hasInteractedToday=false in morning → morning_greeting', () => {
    expect(fromInput({ localHour: 8, hasInteractedToday: false })).toBe('morning_greeting');
  });

  it('hasInteractedToday=true in morning → morning (no greeting again)', () => {
    expect(fromInput({ localHour: 8, hasInteractedToday: true })).toBe('morning');
  });

  it('hasInteractedToday only matters in the morning window', () => {
    // Lunch window: greeting flag is irrelevant; lunch state wins.
    expect(fromInput({ localHour: 12, hasInteractedToday: false })).toBe('lunch');
    // Evening: same.
    expect(fromInput({ localHour: 18, hasInteractedToday: false })).toBe('evening');
    // Concluding: same.
    expect(fromInput({ localHour: 22, hasInteractedToday: false })).toBe('concluding');
  });
});

describe('DailyFlowMachine.policy', () => {
  it('returns a directive for every state', () => {
    const states: DailyFlowState[] = [
      'morning_greeting',
      'morning',
      'lunch',
      'post_lunch',
      'evening',
      'concluding',
    ];
    for (const s of states) {
      const policy = policyForDailyFlow(s);
      expect(policy.state).toBe(s);
      expect(policy.directive.length).toBeGreaterThan(20);
    }
  });

  it('morning_greeting directive forbids tool calls and the session-start echo', () => {
    const policy = policyForDailyFlow('morning_greeting');
    expect(policy.directive).toMatch(/no tools/i);
    expect(policy.directive).toMatch(/session-start/i);
  });

  it('lunch directive instructs the agent to record lunch_eaten via update_user_profile', () => {
    const policy = policyForDailyFlow('lunch');
    expect(policy.directive).toMatch(/update_user_profile/);
    expect(policy.directive).toMatch(/lunch_eaten/);
  });
});

describe('DailyFlowMachine instance API', () => {
  it('current() returns the derived state', () => {
    const m = DailyFlowMachine.from({ localHour: 9, hasInteractedToday: true, lunchEaten: false });
    expect(m.current()).toBe('morning');
  });

  it('policy().directive matches policyForDailyFlow', () => {
    const m = DailyFlowMachine.from({ localHour: 18, hasInteractedToday: true, lunchEaten: true });
    expect(m.policy().directive).toBe(policyForDailyFlow('evening').directive);
  });
});
