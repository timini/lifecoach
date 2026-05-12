"""Mirrors `packages/user-state/src/UsageStateMachine.test.ts`."""

from __future__ import annotations

import pytest

from lifecoach_agent.state import (
    ANONYMOUS_HARD_LIMIT_AFTER,
    FREE_HARD_LIMIT_AFTER,
    MODEL_DOWNGRADE_AFTER,
    PRO_NUDGE_AFTER,
    SIGNUP_NUDGE_AFTER,
    UsageInputs,
    UsagePolicy,
    UsageState,
    UsageStateMachine,
    UserState,
    policy_for_usage,
)


def _from(*, user_state: UserState, chat_count: int, tier: str = "free") -> UsageState:
    return UsageStateMachine.from_inputs(
        UsageInputs(user_state=user_state, chat_count=chat_count, tier=tier)  # type: ignore[arg-type]
    ).current()


# --- derivation -----------------------------------------------------------


def test_brand_new_anonymous_is_free_fresh() -> None:
    assert _from(user_state="anonymous", chat_count=0) == "free_fresh"


def test_anonymous_just_below_signup_threshold_is_fresh() -> None:
    assert _from(user_state="anonymous", chat_count=SIGNUP_NUDGE_AFTER - 1) == "free_fresh"


def test_anonymous_at_signup_threshold_flips_to_signup_nudge() -> None:
    assert _from(user_state="anonymous", chat_count=SIGNUP_NUDGE_AFTER) == "free_signup_nudge"


def test_anonymous_just_below_downgrade_is_signup_nudge() -> None:
    assert (
        _from(user_state="anonymous", chat_count=MODEL_DOWNGRADE_AFTER - 1) == "free_signup_nudge"
    )


def test_anonymous_at_downgrade_flips_to_throttled() -> None:
    assert _from(user_state="anonymous", chat_count=MODEL_DOWNGRADE_AFTER) == "free_throttled"


def test_anonymous_at_hard_limit_is_blocked() -> None:
    assert _from(user_state="anonymous", chat_count=ANONYMOUS_HARD_LIMIT_AFTER) == "free_blocked"


@pytest.mark.parametrize(
    "user_state",
    ["email_pending", "email_verified", "google_linked", "workspace_connected"],
)
def test_signed_in_below_pro_is_signed_in(user_state: UserState) -> None:
    assert _from(user_state=user_state, chat_count=PRO_NUDGE_AFTER - 1) == "free_signed_in"


def test_signed_in_at_pro_threshold_flips_to_pro_pitch() -> None:
    assert _from(user_state="google_linked", chat_count=PRO_NUDGE_AFTER) == "free_pro_pitch"


def test_signed_in_at_hard_limit_is_blocked() -> None:
    assert (
        _from(user_state="google_linked", chat_count=FREE_HARD_LIMIT_AFTER)
        == "free_signed_in_blocked"
    )


def test_pro_tier_is_always_pro() -> None:
    assert _from(user_state="anonymous", chat_count=0, tier="pro") == "pro"
    assert _from(user_state="workspace_connected", chat_count=9999, tier="pro") == "pro"


def test_signing_in_drops_out_of_throttled() -> None:
    assert _from(user_state="anonymous", chat_count=MODEL_DOWNGRADE_AFTER + 4) == "free_throttled"
    assert (
        _from(user_state="google_linked", chat_count=MODEL_DOWNGRADE_AFTER + 4) == "free_signed_in"
    )


# --- policy_for_usage -----------------------------------------------------


def test_policy_free_fresh() -> None:
    assert policy_for_usage("free_fresh") == UsagePolicy(
        state="free_fresh",
        model="gemini-3-flash-preview",
        nudge_mode="none",
        upgrade_tool_available=False,
        llm_allowed=True,
    )


def test_policy_free_signup_nudge() -> None:
    assert policy_for_usage("free_signup_nudge") == UsagePolicy(
        state="free_signup_nudge",
        model="gemini-3-flash-preview",
        nudge_mode="signup",
        upgrade_tool_available=False,
        llm_allowed=True,
    )


def test_policy_free_throttled() -> None:
    assert policy_for_usage("free_throttled") == UsagePolicy(
        state="free_throttled",
        model="gemini-flash-lite-latest",
        nudge_mode="signup",
        upgrade_tool_available=False,
        llm_allowed=True,
    )


def test_policy_free_blocked() -> None:
    assert policy_for_usage("free_blocked") == UsagePolicy(
        state="free_blocked",
        model="gemini-flash-lite-latest",
        nudge_mode="signup",
        upgrade_tool_available=False,
        llm_allowed=False,
        limit_message="Free anonymous chat limit reached. Sign in to continue.",
    )


def test_policy_free_signed_in() -> None:
    assert policy_for_usage("free_signed_in") == UsagePolicy(
        state="free_signed_in",
        model="gemini-3-flash-preview",
        nudge_mode="none",
        upgrade_tool_available=False,
        llm_allowed=True,
    )


def test_policy_free_pro_pitch() -> None:
    assert policy_for_usage("free_pro_pitch") == UsagePolicy(
        state="free_pro_pitch",
        model="gemini-3-flash-preview",
        nudge_mode="pro",
        upgrade_tool_available=True,
        llm_allowed=True,
    )


def test_policy_signed_in_blocked() -> None:
    assert policy_for_usage("free_signed_in_blocked") == UsagePolicy(
        state="free_signed_in_blocked",
        model="gemini-flash-lite-latest",
        nudge_mode="pro",
        upgrade_tool_available=True,
        llm_allowed=False,
        limit_message="Free chat limit reached. Upgrade to Pro to continue.",
    )


def test_policy_pro() -> None:
    assert policy_for_usage("pro") == UsagePolicy(
        state="pro",
        model="gemini-3-flash-preview",
        nudge_mode="none",
        upgrade_tool_available=False,
        llm_allowed=True,
    )


def test_policy_delegation() -> None:
    m = UsageStateMachine.from_inputs(
        UsageInputs(user_state="anonymous", chat_count=MODEL_DOWNGRADE_AFTER, tier="free")
    )
    assert m.policy() == policy_for_usage("free_throttled")


def test_thresholds_strictly_ordered() -> None:
    assert SIGNUP_NUDGE_AFTER > 0
    assert MODEL_DOWNGRADE_AFTER > SIGNUP_NUDGE_AFTER
    assert PRO_NUDGE_AFTER > 0
    assert ANONYMOUS_HARD_LIMIT_AFTER > MODEL_DOWNGRADE_AFTER
    assert FREE_HARD_LIMIT_AFTER > PRO_NUDGE_AFTER
