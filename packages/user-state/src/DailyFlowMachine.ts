/**
 * Daily-flow state machine — orthogonal to UserStateMachine and
 * UsageStateMachine.
 *
 * UserStateMachine: "who is this user?" (auth + workspace).
 * UsageStateMachine: "what model + nudge for this turn?".
 * DailyFlowMachine: "what time-of-day directive for this turn?".
 *
 * Pure derivation from three inputs:
 *   - localHour:           the user's wall-clock hour (0-23) in their tz.
 *   - hasInteractedToday:  true if the user has sent any *real* messages
 *                          on today's session — the synthetic
 *                          `__session_start__` kickoff doesn't count.
 *   - lunchEaten:          true if the user has confirmed they ate lunch.
 *                          Read from user.yaml `daily.{YYYY-MM-DD}.lunch_eaten`.
 *
 * No persisted state, no transitions — recomputed every turn. Same shape
 * as UsageStateMachine.from(...).
 */

export type DailyFlowState =
  /** First contact of the day in the morning window. */
  | 'morning_greeting'
  /** Morning, after the first turn has happened. */
  | 'morning'
  /** Lunch window AND user hasn't confirmed eating yet. */
  | 'lunch'
  /** Past lunch (either time has moved on, or user confirmed eating). */
  | 'post_lunch'
  /** Evening — reflective tone. */
  | 'evening'
  /** Late night / early morning — wrap-up tone. */
  | 'concluding';

export interface DailyFlowInput {
  localHour: number;
  hasInteractedToday: boolean;
  lunchEaten: boolean;
}

export interface DailyFlowPolicy {
  state: DailyFlowState;
  /**
   * Prompt directive injected under a DAY_PHASE block by buildInstruction.
   * One paragraph each, written to be appended after the persona header.
   */
  directive: string;
}

const DIRECTIVES: Record<DailyFlowState, string> = {
  morning_greeting:
    "First contact of the day. Greet warmly using the user's name from profile if you have it, briefly comment on the morning, and ask one open, energising question to set the tone. Do not call any tools on this turn. Do not echo the session-start token back to the user.",
  morning:
    "It's morning and the user is mid-flow. Match their energy — concise, supportive, momentum-building. Avoid re-greeting; pick up where the conversation is.",
  lunch:
    "It's around lunch time and we don't yet know if they've eaten. Naturally check in about food / break — a short, caring nudge, not a hard prompt. If they say they ate (or just had X), call `update_user_profile` with `path=daily.{today}.lunch_eaten` and `value=true` so we don't ask again. Today's date in the path is the same YYYY-MM-DD already on the session id.",
  post_lunch:
    'Past the lunch window. Energy can be low after eating — keep it light and check in on the rest of the afternoon. No need to mention food unless the user does.',
  evening:
    "Evening tone — reflective, encouraging, willing to slow down. Good time to ask about the day's wins and what's tomorrow's first step.",
  concluding:
    'Late hours. Be gentle and brief — wind-down tone, encourage rest. Avoid energising or task-laden questions; if the user is processing the day, listen.',
};

export function policyForDailyFlow(state: DailyFlowState): DailyFlowPolicy {
  return { state, directive: DIRECTIVES[state] };
}

export class DailyFlowMachine {
  private readonly state: DailyFlowState;

  constructor(initial: DailyFlowState) {
    this.state = initial;
  }

  current(): DailyFlowState {
    return this.state;
  }

  policy(): DailyFlowPolicy {
    return policyForDailyFlow(this.state);
  }

  static from(input: DailyFlowInput): DailyFlowMachine {
    return new DailyFlowMachine(deriveState(input));
  }
}

function deriveState({
  localHour,
  hasInteractedToday,
  lunchEaten,
}: DailyFlowInput): DailyFlowState {
  // Late night → early morning before the day "starts".
  if (localHour >= 21 || localHour < 5) return 'concluding';

  // Morning window (5–11). First-of-day branch is the only override here.
  if (localHour >= 5 && localHour < 11) {
    return hasInteractedToday ? 'morning' : 'morning_greeting';
  }

  // Lunch window (11–14). Eaten-yet flag picks the variant.
  if (localHour >= 11 && localHour < 14) {
    return lunchEaten ? 'post_lunch' : 'lunch';
  }

  // Late-lunch grace (14–15). If they still haven't eaten, keep nudging.
  if (localHour >= 14 && localHour < 15 && !lunchEaten) return 'lunch';

  // Afternoon (14–17, plus the 14–15 window when lunch has been eaten).
  if (localHour >= 14 && localHour < 17) return 'post_lunch';

  // Evening (17–21).
  return 'evening';
}
