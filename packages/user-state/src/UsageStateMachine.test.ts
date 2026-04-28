import { describe, expect, it } from 'vitest';
import {
  MODEL_DOWNGRADE_AFTER,
  PRO_NUDGE_AFTER,
  SIGNUP_NUDGE_AFTER,
  type UsageState,
  UsageStateMachine,
  policyForUsage,
} from './UsageStateMachine.js';
import type { UserState } from './types.js';

describe('UsageStateMachine.from', () => {
  it('classifies a brand-new anonymous user as free_fresh', () => {
    expect(
      UsageStateMachine.from({
        userState: 'anonymous',
        chatCount: 0,
        tier: 'free',
      }).current(),
    ).toBe('free_fresh');
  });

  it('stays in free_fresh up to but not including SIGNUP_NUDGE_AFTER', () => {
    const last = UsageStateMachine.from({
      userState: 'anonymous',
      chatCount: SIGNUP_NUDGE_AFTER - 1,
      tier: 'free',
    });
    expect(last.current()).toBe('free_fresh');
  });

  it('flips to free_signup_nudge at exactly SIGNUP_NUDGE_AFTER', () => {
    expect(
      UsageStateMachine.from({
        userState: 'anonymous',
        chatCount: SIGNUP_NUDGE_AFTER,
        tier: 'free',
      }).current(),
    ).toBe('free_signup_nudge');
  });

  it('stays in free_signup_nudge up to but not including MODEL_DOWNGRADE_AFTER', () => {
    expect(
      UsageStateMachine.from({
        userState: 'anonymous',
        chatCount: MODEL_DOWNGRADE_AFTER - 1,
        tier: 'free',
      }).current(),
    ).toBe('free_signup_nudge');
  });

  it('flips to free_throttled at exactly MODEL_DOWNGRADE_AFTER', () => {
    expect(
      UsageStateMachine.from({
        userState: 'anonymous',
        chatCount: MODEL_DOWNGRADE_AFTER,
        tier: 'free',
      }).current(),
    ).toBe('free_throttled');
  });

  it.each<[UserState]>([
    ['email_pending'],
    ['email_verified'],
    ['google_linked'],
    ['workspace_connected'],
  ])('classifies signed-in (%s) below pro threshold as free_signed_in', (userState) => {
    expect(
      UsageStateMachine.from({
        userState,
        chatCount: PRO_NUDGE_AFTER - 1,
        tier: 'free',
      }).current(),
    ).toBe('free_signed_in');
  });

  it('flips to free_pro_pitch at exactly PRO_NUDGE_AFTER for signed-in users', () => {
    expect(
      UsageStateMachine.from({
        userState: 'google_linked',
        chatCount: PRO_NUDGE_AFTER,
        tier: 'free',
      }).current(),
    ).toBe('free_pro_pitch');
  });

  it('a tier=pro user is always in the pro state regardless of count or auth', () => {
    expect(
      UsageStateMachine.from({
        userState: 'anonymous',
        chatCount: 0,
        tier: 'pro',
      }).current(),
    ).toBe('pro');
    expect(
      UsageStateMachine.from({
        userState: 'workspace_connected',
        chatCount: 9999,
        tier: 'pro',
      }).current(),
    ).toBe('pro');
  });

  it('signing in (anonymous → google_linked) drops out of free_throttled even if count is high', () => {
    // Same chatCount, different userState — model downgrade only applies to
    // anonymous. Signing up rewards the user with full Flash again.
    const anon = UsageStateMachine.from({
      userState: 'anonymous',
      chatCount: MODEL_DOWNGRADE_AFTER + 5,
      tier: 'free',
    });
    expect(anon.current()).toBe('free_throttled');

    const signedIn = UsageStateMachine.from({
      userState: 'google_linked',
      chatCount: MODEL_DOWNGRADE_AFTER + 5,
      tier: 'free',
    });
    expect(signedIn.current()).toBe('free_signed_in');
  });
});

describe('policyForUsage', () => {
  it.each<[UsageState, ReturnType<typeof policyForUsage>]>([
    [
      'free_fresh',
      {
        state: 'free_fresh',
        model: 'gemini-3-flash-preview',
        nudgeMode: 'none',
        upgradeToolAvailable: false,
      },
    ],
    [
      'free_signup_nudge',
      {
        state: 'free_signup_nudge',
        model: 'gemini-3-flash-preview',
        nudgeMode: 'signup',
        upgradeToolAvailable: false,
      },
    ],
    [
      'free_throttled',
      {
        state: 'free_throttled',
        model: 'gemini-flash-lite-latest',
        nudgeMode: 'signup',
        upgradeToolAvailable: false,
      },
    ],
    [
      'free_signed_in',
      {
        state: 'free_signed_in',
        model: 'gemini-3-flash-preview',
        nudgeMode: 'none',
        upgradeToolAvailable: false,
      },
    ],
    [
      'free_pro_pitch',
      {
        state: 'free_pro_pitch',
        model: 'gemini-3-flash-preview',
        nudgeMode: 'pro',
        upgradeToolAvailable: true,
      },
    ],
    [
      'pro',
      {
        state: 'pro',
        model: 'gemini-3-flash-preview',
        nudgeMode: 'none',
        upgradeToolAvailable: false,
      },
    ],
  ])('returns the correct policy for %s', (state, expected) => {
    expect(policyForUsage(state)).toEqual(expected);
  });
});

describe('UsageStateMachine.policy()', () => {
  it('delegates to policyForUsage for the current state', () => {
    const m = UsageStateMachine.from({
      userState: 'anonymous',
      chatCount: MODEL_DOWNGRADE_AFTER,
      tier: 'free',
    });
    expect(m.policy()).toEqual(policyForUsage('free_throttled'));
  });
});

describe('threshold constants', () => {
  it('thresholds are strictly ordered so transitions are unambiguous', () => {
    expect(SIGNUP_NUDGE_AFTER).toBeGreaterThan(0);
    expect(MODEL_DOWNGRADE_AFTER).toBeGreaterThan(SIGNUP_NUDGE_AFTER);
    expect(PRO_NUDGE_AFTER).toBeGreaterThan(0);
  });
});
