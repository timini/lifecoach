"""UsageStateMachine — orthogonal to UserStateMachine.

UserState answers "who is this user?" (auth + workspace). UsageState
answers "how should we serve them this turn?" — which model to use,
which nudge directive (if any) to inject, whether `upgrade_to_pro` is
exposed as a tool, and whether to short-circuit before the model call
(the "wall" states).

Anonymous funnel (turn → state):
  0–4    free_fresh         full model, no nudge
  5–9    free_signup_soft   full model, soft signup nudge
  10–14  free_signup_hard   full model, hard signup nudge + credit count
  15–24  free_throttled     flash-lite, hard signup + throttled notice
  25+    free_wall          NO MODEL CALL — server emits `event: wall`

Signed-in funnel (turn → state):
  0–19   free_signed_in     full model, no nudge
  20–49  pro_pitch_soft     full model, soft pro nudge
  50–99  pro_pitch_hard     flash-lite, hard pro nudge
  100+   signed_in_wall     NO MODEL CALL — server emits `event: wall`

`pro` overrides the funnel — pro tier always gets the full model.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final, Literal

from lifecoach_agent.state.types import UserState

# --- Anonymous thresholds -------------------------------------------------
# Turn N is "the user's Nth chat" (chatTurnCount). State entered AT-or-above.
ANON_SIGNUP_SOFT_FROM: Final[int] = 5
ANON_SIGNUP_HARD_FROM: Final[int] = 10
ANON_THROTTLED_FROM: Final[int] = 15
ANON_WALL_FROM: Final[int] = 25

# --- Signed-in-free thresholds --------------------------------------------
SIGNED_IN_PRO_SOFT_FROM: Final[int] = 20
SIGNED_IN_PRO_HARD_FROM: Final[int] = 50
SIGNED_IN_WALL_FROM: Final[int] = 100


Tier = Literal["free", "pro"]
Model = Literal["gemini-3-flash-preview", "gemini-flash-lite-latest"]
NudgeMode = Literal["none", "signup_soft", "signup_hard", "pro_soft", "pro_hard"]
WallReason = Literal["free_limit", "free_signed_in_limit"]
WallCta = Literal["auth_user", "upgrade_to_pro"]
UsageState = Literal[
    "free_fresh",
    "free_signup_soft",
    "free_signup_hard",
    "free_throttled",
    "free_wall",
    "free_signed_in",
    "pro_pitch_soft",
    "pro_pitch_hard",
    "signed_in_wall",
    "pro",
]


@dataclass(frozen=True)
class UsagePolicy:
    state: UsageState
    # None ONLY when walled — server short-circuits before the runner so
    # no model is invoked. Every non-walled state has a concrete model.
    model: Model | None
    nudge_mode: NudgeMode
    upgrade_tool_available: bool
    # True for `free_wall` + `signed_in_wall`. Server.py inspects this and
    # emits `event: wall` instead of invoking the Runner.
    walled: bool = False
    # Only set when walled — drives the wall SSE event payload + the FE
    # paywall card's CTA button.
    wall_reason: WallReason | None = None
    wall_cta: WallCta | None = None


_POLICIES: dict[UsageState, UsagePolicy] = {
    "free_fresh": UsagePolicy(
        state="free_fresh",
        model="gemini-3-flash-preview",
        nudge_mode="none",
        upgrade_tool_available=False,
    ),
    "free_signup_soft": UsagePolicy(
        state="free_signup_soft",
        model="gemini-3-flash-preview",
        nudge_mode="signup_soft",
        upgrade_tool_available=False,
    ),
    "free_signup_hard": UsagePolicy(
        state="free_signup_hard",
        model="gemini-3-flash-preview",
        nudge_mode="signup_hard",
        upgrade_tool_available=False,
    ),
    "free_throttled": UsagePolicy(
        state="free_throttled",
        model="gemini-flash-lite-latest",
        nudge_mode="signup_hard",
        upgrade_tool_available=False,
    ),
    "free_wall": UsagePolicy(
        state="free_wall",
        model=None,
        nudge_mode="none",
        upgrade_tool_available=False,
        walled=True,
        wall_reason="free_limit",
        wall_cta="auth_user",
    ),
    "free_signed_in": UsagePolicy(
        state="free_signed_in",
        model="gemini-3-flash-preview",
        nudge_mode="none",
        upgrade_tool_available=False,
    ),
    "pro_pitch_soft": UsagePolicy(
        state="pro_pitch_soft",
        model="gemini-3-flash-preview",
        nudge_mode="pro_soft",
        upgrade_tool_available=True,
    ),
    "pro_pitch_hard": UsagePolicy(
        state="pro_pitch_hard",
        model="gemini-flash-lite-latest",
        nudge_mode="pro_hard",
        upgrade_tool_available=True,
    ),
    "signed_in_wall": UsagePolicy(
        state="signed_in_wall",
        model=None,
        nudge_mode="none",
        upgrade_tool_available=False,
        walled=True,
        wall_reason="free_signed_in_limit",
        wall_cta="upgrade_to_pro",
    ),
    "pro": UsagePolicy(
        state="pro",
        model="gemini-3-flash-preview",
        nudge_mode="none",
        upgrade_tool_available=False,
    ),
}


def policy_for_usage(state: UsageState) -> UsagePolicy:
    return _POLICIES[state]


@dataclass(frozen=True)
class UsageInputs:
    user_state: UserState
    chat_count: int
    tier: Tier


class UsageStateMachine:
    def __init__(self, initial: UsageState) -> None:
        self._state: UsageState = initial

    def current(self) -> UsageState:
        return self._state

    def policy(self) -> UsagePolicy:
        return policy_for_usage(self._state)

    @staticmethod
    def from_inputs(inputs: UsageInputs) -> UsageStateMachine:
        """Pure derivation — (user_state, chat_count, tier) → UsageState.
        Each /chat turn calls this once with fresh inputs; no transitions."""
        return UsageStateMachine(_derive_state(inputs))


def _derive_state(inputs: UsageInputs) -> UsageState:
    if inputs.tier == "pro":
        return "pro"

    if inputs.user_state == "anonymous":
        if inputs.chat_count < ANON_SIGNUP_SOFT_FROM:
            return "free_fresh"
        if inputs.chat_count < ANON_SIGNUP_HARD_FROM:
            return "free_signup_soft"
        if inputs.chat_count < ANON_THROTTLED_FROM:
            return "free_signup_hard"
        if inputs.chat_count < ANON_WALL_FROM:
            return "free_throttled"
        return "free_wall"

    # Any signed-in non-pro state: email_pending, email_verified,
    # google_linked, workspace_connected. The funnel ratchets on
    # chat_count regardless of workspace status — even workspace_connected
    # users hit the pro pitch + wall on heavy free usage.
    if inputs.chat_count < SIGNED_IN_PRO_SOFT_FROM:
        return "free_signed_in"
    if inputs.chat_count < SIGNED_IN_PRO_HARD_FROM:
        return "pro_pitch_soft"
    if inputs.chat_count < SIGNED_IN_WALL_FROM:
        return "pro_pitch_hard"
    return "signed_in_wall"
