"""UsageStateMachine — orthogonal to UserStateMachine.

UserState answers "who is this user?" (auth + workspace). UsageState
answers "how should we serve them this turn?" — which model to use,
whether to inject a signup or pro nudge, and whether `upgrade_to_pro` is
exposed as a tool.

Mirrors `packages/user-state/src/UsageStateMachine.ts`.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final, Literal

from lifecoach_agent.state.types import UserState

# Anonymous turns before the LLM starts naturally suggesting signup.
SIGNUP_NUDGE_AFTER: Final[int] = 5
# Anonymous turns at which we switch to the cheaper Flash Lite model.
MODEL_DOWNGRADE_AFTER: Final[int] = 15
# Signed-in free turns at which the LLM gains the upgrade_to_pro tool.
PRO_NUDGE_AFTER: Final[int] = 30
# Anonymous free turns allowed before blocking LLM calls entirely.
ANONYMOUS_HARD_LIMIT_AFTER: Final[int] = 20
# Signed-in free turns allowed before blocking LLM calls entirely.
FREE_HARD_LIMIT_AFTER: Final[int] = 100

Tier = Literal["free", "pro"]
Model = Literal["gemini-3-flash-preview", "gemini-flash-lite-latest"]
NudgeMode = Literal["none", "signup", "pro"]
UsageState = Literal[
    "free_fresh",
    "free_signup_nudge",
    "free_throttled",
    "free_blocked",
    "free_signed_in",
    "free_pro_pitch",
    "free_signed_in_blocked",
    "pro",
]


@dataclass(frozen=True)
class UsagePolicy:
    state: UsageState
    model: Model
    nudge_mode: NudgeMode
    upgrade_tool_available: bool
    llm_allowed: bool
    limit_message: str | None = None


_POLICIES: dict[UsageState, UsagePolicy] = {
    "free_fresh": UsagePolicy(
        state="free_fresh",
        model="gemini-3-flash-preview",
        nudge_mode="none",
        upgrade_tool_available=False,
        llm_allowed=True,
    ),
    "free_signup_nudge": UsagePolicy(
        state="free_signup_nudge",
        model="gemini-3-flash-preview",
        nudge_mode="signup",
        upgrade_tool_available=False,
        llm_allowed=True,
    ),
    "free_throttled": UsagePolicy(
        state="free_throttled",
        model="gemini-flash-lite-latest",
        nudge_mode="signup",
        upgrade_tool_available=False,
        llm_allowed=True,
    ),
    "free_blocked": UsagePolicy(
        state="free_blocked",
        model="gemini-flash-lite-latest",
        nudge_mode="signup",
        upgrade_tool_available=False,
        llm_allowed=False,
        limit_message="Free anonymous chat limit reached. Sign in to continue.",
    ),
    "free_signed_in": UsagePolicy(
        state="free_signed_in",
        model="gemini-3-flash-preview",
        nudge_mode="none",
        upgrade_tool_available=False,
        llm_allowed=True,
    ),
    "free_pro_pitch": UsagePolicy(
        state="free_pro_pitch",
        model="gemini-3-flash-preview",
        nudge_mode="pro",
        upgrade_tool_available=True,
        llm_allowed=True,
    ),
    "free_signed_in_blocked": UsagePolicy(
        state="free_signed_in_blocked",
        model="gemini-flash-lite-latest",
        nudge_mode="pro",
        upgrade_tool_available=True,
        llm_allowed=False,
        limit_message="Free chat limit reached. Upgrade to Pro to continue.",
    ),
    "pro": UsagePolicy(
        state="pro",
        model="gemini-3-flash-preview",
        nudge_mode="none",
        upgrade_tool_available=False,
        llm_allowed=True,
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
        if inputs.chat_count >= ANONYMOUS_HARD_LIMIT_AFTER:
            return "free_blocked"
        if inputs.chat_count < SIGNUP_NUDGE_AFTER:
            return "free_fresh"
        if inputs.chat_count < MODEL_DOWNGRADE_AFTER:
            return "free_signup_nudge"
        return "free_throttled"

    # Any signed-in state: email_pending, email_verified, google_linked,
    # workspace_connected. Pro nudge is a function of message count, not
    # workspace status — even workspace_connected users should get
    # pitched when they're heavy free users.
    if inputs.chat_count >= FREE_HARD_LIMIT_AFTER:
        return "free_signed_in_blocked"
    if inputs.chat_count < PRO_NUDGE_AFTER:
        return "free_signed_in"
    return "free_pro_pitch"
