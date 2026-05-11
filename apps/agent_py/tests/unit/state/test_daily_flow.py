"""Mirrors `packages/user-state/src/DailyFlowMachine.test.ts`."""

from __future__ import annotations

import re

from lifecoach_agent.state import (
    DailyFlowInput,
    DailyFlowMachine,
    DailyFlowState,
    policy_for_daily_flow,
)


def _from(
    *,
    local_hour: int = 9,
    has_interacted_today: bool = False,
    lunch_eaten: bool = False,
) -> DailyFlowState:
    return DailyFlowMachine.from_input(
        DailyFlowInput(
            local_hour=local_hour,
            has_interacted_today=has_interacted_today,
            lunch_eaten=lunch_eaten,
        )
    ).current()


# --- time windows --------------------------------------------------------


def test_5am_no_interaction_is_morning_greeting() -> None:
    assert _from(local_hour=5, has_interacted_today=False) == "morning_greeting"


def test_10_with_interaction_is_morning() -> None:
    assert _from(local_hour=10, has_interacted_today=True) == "morning"


def test_11_no_eaten_is_lunch() -> None:
    assert _from(local_hour=11, lunch_eaten=False) == "lunch"


def test_13_with_eaten_is_post_lunch() -> None:
    assert _from(local_hour=13, lunch_eaten=True) == "post_lunch"


def test_14_30_no_eaten_still_lunch() -> None:
    assert _from(local_hour=14, lunch_eaten=False) == "lunch"


def test_14_30_with_eaten_post_lunch() -> None:
    assert _from(local_hour=14, lunch_eaten=True) == "post_lunch"


def test_16_post_lunch_regardless_of_eaten() -> None:
    assert _from(local_hour=16, lunch_eaten=False) == "post_lunch"
    assert _from(local_hour=16, lunch_eaten=True) == "post_lunch"


def test_17_evening() -> None:
    assert _from(local_hour=17) == "evening"


def test_20_evening() -> None:
    assert _from(local_hour=20) == "evening"


def test_21_concluding() -> None:
    assert _from(local_hour=21) == "concluding"


def test_1_concluding() -> None:
    assert _from(local_hour=1) == "concluding"


def test_4_concluding() -> None:
    assert _from(local_hour=4) == "concluding"


# --- first-of-day override -----------------------------------------------


def test_no_interaction_morning_is_greeting() -> None:
    assert _from(local_hour=8, has_interacted_today=False) == "morning_greeting"


def test_interaction_morning_no_repeat_greeting() -> None:
    assert _from(local_hour=8, has_interacted_today=True) == "morning"


def test_interaction_flag_only_matters_in_morning() -> None:
    assert _from(local_hour=12, has_interacted_today=False) == "lunch"
    assert _from(local_hour=18, has_interacted_today=False) == "evening"
    assert _from(local_hour=22, has_interacted_today=False) == "concluding"


# --- policy --------------------------------------------------------------


def test_each_state_has_directive() -> None:
    for s in (
        "morning_greeting",
        "morning",
        "lunch",
        "post_lunch",
        "evening",
        "concluding",
    ):
        p = policy_for_daily_flow(s)  # type: ignore[arg-type]
        assert p.state == s
        assert len(p.directive) > 20


def test_morning_greeting_forbids_tools_and_session_echo() -> None:
    d = policy_for_daily_flow("morning_greeting").directive
    assert re.search(r"do not call any tools", d, re.I)
    assert re.search(r"session-start", d, re.I)


def test_lunch_directive_calls_update_user_profile() -> None:
    d = policy_for_daily_flow("lunch").directive
    assert "update_user_profile" in d
    assert "lunch_eaten" in d


def test_instance_api_current() -> None:
    m = DailyFlowMachine.from_input(
        DailyFlowInput(local_hour=9, has_interacted_today=True, lunch_eaten=False)
    )
    assert m.current() == "morning"


def test_instance_api_policy_matches_module_fn() -> None:
    m = DailyFlowMachine.from_input(
        DailyFlowInput(local_hour=18, has_interacted_today=True, lunch_eaten=True)
    )
    assert m.policy().directive == policy_for_daily_flow("evening").directive
