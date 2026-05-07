"""DailyFlowMachine — orthogonal to UserState and UsageState.

Decides the time-of-day directive injected under the DAY_PHASE block in
the system prompt. Pure derivation: no persisted state, no transitions —
recomputed every turn from `(local_hour, has_interacted_today, lunch_eaten)`.

Mirrors `packages/user-state/src/DailyFlowMachine.ts`.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

DailyFlowState = Literal[
    "morning_greeting",
    "morning",
    "lunch",
    "post_lunch",
    "evening",
    "concluding",
]


@dataclass(frozen=True)
class DailyFlowInput:
    local_hour: int
    has_interacted_today: bool
    lunch_eaten: bool


@dataclass(frozen=True)
class DailyFlowPolicy:
    state: DailyFlowState
    directive: str


_DIRECTIVES: dict[DailyFlowState, str] = {
    "morning_greeting": (
        "First contact of the day. Greet warmly using the user's name from profile "
        "if you have it, briefly comment on the morning, and ask one open, energising "
        "question to set the tone. Do not call any tools on this turn. Do not echo the "
        "session-start token back to the user."
    ),
    "morning": (
        "It's morning and the user is mid-flow. Match their energy — concise, "
        "supportive, momentum-building. Avoid re-greeting; pick up where the "
        "conversation is."
    ),
    "lunch": (
        "It's around lunch time and we don't yet know if they've eaten. Naturally "
        "check in about food / break — a short, caring nudge, not a hard prompt. If "
        "they say they ate (or just had X), call `update_user_profile` with "
        "`path=daily.{today}.lunch_eaten` and `value=true` so we don't ask again. "
        "Today's date in the path is the same YYYY-MM-DD already on the session id."
    ),
    "post_lunch": (
        "Past the lunch window. Energy can be low after eating — keep it light and "
        "check in on the rest of the afternoon. No need to mention food unless the "
        "user does."
    ),
    "evening": (
        "Evening tone — reflective, encouraging, willing to slow down. Good time to "
        "ask about the day's wins and what's tomorrow's first step."
    ),
    "concluding": (
        "Late hours. Be gentle and brief — wind-down tone, encourage rest. Avoid "
        "energising or task-laden questions; if the user is processing the day, listen."
    ),
}


def policy_for_daily_flow(state: DailyFlowState) -> DailyFlowPolicy:
    return DailyFlowPolicy(state=state, directive=_DIRECTIVES[state])


class DailyFlowMachine:
    def __init__(self, initial: DailyFlowState) -> None:
        self._state: DailyFlowState = initial

    def current(self) -> DailyFlowState:
        return self._state

    def policy(self) -> DailyFlowPolicy:
        return policy_for_daily_flow(self._state)

    @staticmethod
    def from_input(inp: DailyFlowInput) -> DailyFlowMachine:
        return DailyFlowMachine(_derive_state(inp))


def _derive_state(inp: DailyFlowInput) -> DailyFlowState:
    h = inp.local_hour

    # Late night → early morning before the day "starts".
    if h >= 21 or h < 5:
        return "concluding"

    # Morning window (5–11). First-of-day branch is the only override here.
    if 5 <= h < 11:
        return "morning" if inp.has_interacted_today else "morning_greeting"

    # Lunch window (11–14). Eaten-yet flag picks the variant.
    if 11 <= h < 14:
        return "post_lunch" if inp.lunch_eaten else "lunch"

    # Late-lunch grace (14–15). If they still haven't eaten, keep nudging.
    if 14 <= h < 15 and not inp.lunch_eaten:
        return "lunch"

    # Afternoon (14–17, plus the 14–15 window when lunch has been eaten).
    if 14 <= h < 17:
        return "post_lunch"

    # Evening (17–21).
    return "evening"
