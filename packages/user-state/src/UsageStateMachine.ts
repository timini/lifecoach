/**
 * Usage state machine — orthogonal to UserStateMachine.
 *
 * UserStateMachine answers "who is this user?" (auth + workspace state).
 * UsageStateMachine answers "how should we serve them this turn?" — which
 * model to construct, whether to inject a signup or pro nudge into the
 * prompt, and whether to expose the upgrade_to_pro tool.
 *
 * Inputs are computed server-side per turn:
 *   - userState: from UserStateMachine.fromFirebaseUser(...)
 *   - chatCount: from userMeta/{uid}.chatTurnCount (incremented at the
 *     start of /chat)
 *   - tier:      from userMeta/{uid}.tier ('free' | 'pro')
 *
 * The machine never sees auth tokens or billing identifiers — it gets
 * just the three derived facts above and emits a deterministic policy.
 *
 * Thresholds are constants here. Easy to tweak in code review; promote
 * to env vars only if we need per-environment overrides.
 */

import type { UserState } from './types.js';

/** Anonymous turns before the LLM starts naturally suggesting signup. */
export const SIGNUP_NUDGE_AFTER = 5;
/** Anonymous turns at which we switch to the cheaper Flash Lite model. */
export const MODEL_DOWNGRADE_AFTER = 15;
/** Signed-in free turns at which the LLM gains the upgrade_to_pro tool. */
export const PRO_NUDGE_AFTER = 30;
/** Anonymous free turns allowed before blocking LLM calls entirely. */
export const ANONYMOUS_HARD_LIMIT_AFTER = 20;
/** Signed-in free turns allowed before blocking LLM calls entirely. */
export const FREE_HARD_LIMIT_AFTER = 100;

export type Tier = 'free' | 'pro';

/** Model identifiers as ADK / Vertex understands them. */
export type Model = 'gemini-3-flash-preview' | 'gemini-flash-lite-latest';

/** What the prompt's coaching directive tells the LLM to nudge for. */
export type NudgeMode = 'none' | 'signup' | 'pro';

export type UsageState =
  | 'free_fresh'
  | 'free_signup_nudge'
  | 'free_throttled'
  | 'free_blocked'
  | 'free_signed_in'
  | 'free_pro_pitch'
  | 'free_signed_in_blocked'
  | 'pro';

export interface UsagePolicy {
  state: UsageState;
  model: Model;
  nudgeMode: NudgeMode;
  upgradeToolAvailable: boolean;
  llmAllowed: boolean;
  limitMessage?: string;
}

const POLICIES: Record<UsageState, UsagePolicy> = {
  free_fresh: {
    state: 'free_fresh',
    model: 'gemini-3-flash-preview',
    nudgeMode: 'none',
    upgradeToolAvailable: false,
    llmAllowed: true,
  },
  free_signup_nudge: {
    state: 'free_signup_nudge',
    model: 'gemini-3-flash-preview',
    nudgeMode: 'signup',
    upgradeToolAvailable: false,
    llmAllowed: true,
  },
  free_throttled: {
    state: 'free_throttled',
    model: 'gemini-flash-lite-latest',
    nudgeMode: 'signup',
    upgradeToolAvailable: false,
    llmAllowed: true,
  },
  free_blocked: {
    state: 'free_blocked',
    model: 'gemini-flash-lite-latest',
    nudgeMode: 'signup',
    upgradeToolAvailable: false,
    llmAllowed: false,
    limitMessage: 'Free anonymous chat limit reached. Sign in to continue.',
  },
  free_signed_in: {
    state: 'free_signed_in',
    model: 'gemini-3-flash-preview',
    nudgeMode: 'none',
    upgradeToolAvailable: false,
    llmAllowed: true,
  },
  free_pro_pitch: {
    state: 'free_pro_pitch',
    model: 'gemini-3-flash-preview',
    nudgeMode: 'pro',
    upgradeToolAvailable: true,
    llmAllowed: true,
  },
  free_signed_in_blocked: {
    state: 'free_signed_in_blocked',
    model: 'gemini-flash-lite-latest',
    nudgeMode: 'pro',
    upgradeToolAvailable: true,
    llmAllowed: false,
    limitMessage: 'Free chat limit reached. Upgrade to Pro to continue.',
  },
  pro: {
    state: 'pro',
    model: 'gemini-3-flash-preview',
    nudgeMode: 'none',
    upgradeToolAvailable: false,
    llmAllowed: true,
  },
};

export function policyForUsage(state: UsageState): UsagePolicy {
  return POLICIES[state];
}

export interface UsageInputs {
  userState: UserState;
  chatCount: number;
  tier: Tier;
}

export class UsageStateMachine {
  private readonly state: UsageState;

  constructor(initial: UsageState) {
    this.state = initial;
  }

  current(): UsageState {
    return this.state;
  }

  policy(): UsagePolicy {
    return policyForUsage(this.state);
  }

  /**
   * Pure derivation — no transitions, just (userState, chatCount, tier)
   * → UsageState. Each /chat turn calls this once with fresh inputs.
   */
  static from(inputs: UsageInputs): UsageStateMachine {
    return new UsageStateMachine(deriveState(inputs));
  }
}

function deriveState({ userState, chatCount, tier }: UsageInputs): UsageState {
  if (tier === 'pro') return 'pro';

  if (userState === 'anonymous') {
    if (chatCount >= ANONYMOUS_HARD_LIMIT_AFTER) return 'free_blocked';
    if (chatCount < SIGNUP_NUDGE_AFTER) return 'free_fresh';
    if (chatCount < MODEL_DOWNGRADE_AFTER) return 'free_signup_nudge';
    return 'free_throttled';
  }

  // Any signed-in state: email_pending, email_verified, google_linked,
  // workspace_connected. Pro nudge is a function of message count, not
  // workspace status — even workspace_connected users should get pitched
  // when they're heavy free users.
  if (chatCount >= FREE_HARD_LIMIT_AFTER) return 'free_signed_in_blocked';
  if (chatCount < PRO_NUDGE_AFTER) return 'free_signed_in';
  return 'free_pro_pitch';
}
