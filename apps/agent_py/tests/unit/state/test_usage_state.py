"""Tests for UsageStateMachine — the 10-state funnel.

Funnel ordering:
  Anonymous:   free_fresh → free_signup_soft → free_signup_hard
               → free_throttled (downgrade) → free_wall (cutoff)
  Signed-in:   free_signed_in → pro_pitch_soft → pro_pitch_hard
               (downgrade) → signed_in_wall (cutoff)
  Pro tier:    overrides everything → pro
"""

from __future__ import annotations

import pytest

from lifecoach_agent.state import (
    ANON_SIGNUP_HARD_FROM,
    ANON_SIGNUP_SOFT_FROM,
    ANON_THROTTLED_FROM,
    ANON_WALL_FROM,
    SIGNED_IN_PRO_HARD_FROM,
    SIGNED_IN_PRO_SOFT_FROM,
    SIGNED_IN_WALL_FROM,
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


# --- Anonymous funnel derivation -----------------------------------------


def test_brand_new_anonymous_is_free_fresh() -> None:
    assert _from(user_state="anonymous", chat_count=0) == "free_fresh"


def test_anonymous_just_below_signup_soft_is_fresh() -> None:
    assert _from(user_state="anonymous", chat_count=ANON_SIGNUP_SOFT_FROM - 1) == "free_fresh"


def test_anonymous_at_signup_soft_flips_to_soft() -> None:
    assert _from(user_state="anonymous", chat_count=ANON_SIGNUP_SOFT_FROM) == "free_signup_soft"


def test_anonymous_just_below_signup_hard_is_soft() -> None:
    assert _from(user_state="anonymous", chat_count=ANON_SIGNUP_HARD_FROM - 1) == "free_signup_soft"


def test_anonymous_at_signup_hard_flips_to_hard() -> None:
    assert _from(user_state="anonymous", chat_count=ANON_SIGNUP_HARD_FROM) == "free_signup_hard"


def test_anonymous_just_below_throttled_is_signup_hard() -> None:
    assert _from(user_state="anonymous", chat_count=ANON_THROTTLED_FROM - 1) == "free_signup_hard"


def test_anonymous_at_throttled_flips_to_throttled() -> None:
    assert _from(user_state="anonymous", chat_count=ANON_THROTTLED_FROM) == "free_throttled"


def test_anonymous_just_below_wall_is_throttled() -> None:
    assert _from(user_state="anonymous", chat_count=ANON_WALL_FROM - 1) == "free_throttled"


def test_anonymous_at_wall_flips_to_wall() -> None:
    assert _from(user_state="anonymous", chat_count=ANON_WALL_FROM) == "free_wall"


def test_anonymous_well_past_wall_stays_walled() -> None:
    assert _from(user_state="anonymous", chat_count=ANON_WALL_FROM + 100) == "free_wall"


# --- Signed-in (free tier) funnel derivation -----------------------------


@pytest.mark.parametrize(
    "user_state",
    ["email_pending", "email_verified", "google_linked", "workspace_connected"],
)
def test_signed_in_below_pro_soft_is_signed_in(user_state: UserState) -> None:
    assert _from(user_state=user_state, chat_count=SIGNED_IN_PRO_SOFT_FROM - 1) == "free_signed_in"


def test_signed_in_at_pro_soft_flips_to_pro_pitch_soft() -> None:
    assert _from(user_state="google_linked", chat_count=SIGNED_IN_PRO_SOFT_FROM) == "pro_pitch_soft"


def test_signed_in_just_below_pro_hard_is_pro_pitch_soft() -> None:
    assert (
        _from(user_state="google_linked", chat_count=SIGNED_IN_PRO_HARD_FROM - 1)
        == "pro_pitch_soft"
    )


def test_signed_in_at_pro_hard_flips_to_pro_pitch_hard() -> None:
    assert _from(user_state="google_linked", chat_count=SIGNED_IN_PRO_HARD_FROM) == "pro_pitch_hard"


def test_signed_in_just_below_wall_is_pro_pitch_hard() -> None:
    assert _from(user_state="google_linked", chat_count=SIGNED_IN_WALL_FROM - 1) == "pro_pitch_hard"


def test_signed_in_at_wall_flips_to_signed_in_wall() -> None:
    assert _from(user_state="google_linked", chat_count=SIGNED_IN_WALL_FROM) == "signed_in_wall"


def test_signed_in_well_past_wall_stays_walled() -> None:
    assert (
        _from(user_state="workspace_connected", chat_count=SIGNED_IN_WALL_FROM + 500)
        == "signed_in_wall"
    )


# --- Pro tier override + transition out of throttled --------------------


def test_pro_tier_overrides_everything() -> None:
    assert _from(user_state="anonymous", chat_count=0, tier="pro") == "pro"
    assert _from(user_state="anonymous", chat_count=ANON_WALL_FROM + 50, tier="pro") == "pro"
    assert _from(user_state="workspace_connected", chat_count=9999, tier="pro") == "pro"


def test_signing_in_drops_out_of_anon_throttled() -> None:
    """The anon funnel is per-uid; signing in resets you onto the
    signed-in funnel using the same chat_count. A heavy anon (turn 17)
    becomes free_signed_in once they auth — they still have spare
    headroom before pro_pitch_soft at turn 20."""
    assert _from(user_state="anonymous", chat_count=17) == "free_throttled"
    assert _from(user_state="google_linked", chat_count=17) == "free_signed_in"


def test_signing_in_drops_out_of_anon_wall() -> None:
    """The anon wall fires at 25 — the same chat_count post-auth lands
    in pro_pitch_soft (since 25 > SIGNED_IN_PRO_SOFT_FROM=20)."""
    assert _from(user_state="anonymous", chat_count=ANON_WALL_FROM) == "free_wall"
    assert _from(user_state="google_linked", chat_count=ANON_WALL_FROM) == "pro_pitch_soft"


# --- policy_for_usage — per-state policy shape ---------------------------


def test_policy_free_fresh() -> None:
    assert policy_for_usage("free_fresh") == UsagePolicy(
        state="free_fresh",
        model="gemini-3-flash-preview",
        nudge_mode="none",
        upgrade_tool_available=False,
    )


def test_policy_free_signup_soft() -> None:
    assert policy_for_usage("free_signup_soft") == UsagePolicy(
        state="free_signup_soft",
        model="gemini-3-flash-preview",
        nudge_mode="signup_soft",
        upgrade_tool_available=False,
    )


def test_policy_free_signup_hard() -> None:
    assert policy_for_usage("free_signup_hard") == UsagePolicy(
        state="free_signup_hard",
        model="gemini-3-flash-preview",
        nudge_mode="signup_hard",
        upgrade_tool_available=False,
    )


def test_policy_free_throttled_uses_flash_lite_with_hard_nudge() -> None:
    policy = policy_for_usage("free_throttled")
    assert policy.model == "gemini-flash-lite-latest"
    assert policy.nudge_mode == "signup_hard"
    assert policy.walled is False
    assert policy.upgrade_tool_available is False


def test_policy_free_wall_is_walled_with_no_model() -> None:
    policy = policy_for_usage("free_wall")
    assert policy.walled is True
    assert policy.model is None
    assert policy.wall_reason == "free_limit"
    assert policy.wall_cta == "auth_user"
    assert policy.nudge_mode == "none"


def test_policy_free_signed_in() -> None:
    assert policy_for_usage("free_signed_in") == UsagePolicy(
        state="free_signed_in",
        model="gemini-3-flash-preview",
        nudge_mode="none",
        upgrade_tool_available=False,
    )


def test_policy_pro_pitch_soft() -> None:
    policy = policy_for_usage("pro_pitch_soft")
    assert policy.model == "gemini-3-flash-preview"
    assert policy.nudge_mode == "pro_soft"
    assert policy.upgrade_tool_available is True
    assert policy.walled is False


def test_policy_pro_pitch_hard_uses_flash_lite() -> None:
    policy = policy_for_usage("pro_pitch_hard")
    assert policy.model == "gemini-flash-lite-latest"
    assert policy.nudge_mode == "pro_hard"
    assert policy.upgrade_tool_available is True
    assert policy.walled is False


def test_policy_signed_in_wall_is_walled_with_upgrade_cta() -> None:
    policy = policy_for_usage("signed_in_wall")
    assert policy.walled is True
    assert policy.model is None
    assert policy.wall_reason == "free_signed_in_limit"
    assert policy.wall_cta == "upgrade_to_pro"


def test_policy_pro() -> None:
    assert policy_for_usage("pro") == UsagePolicy(
        state="pro",
        model="gemini-3-flash-preview",
        nudge_mode="none",
        upgrade_tool_available=False,
    )


def test_policy_delegation() -> None:
    """`UsageStateMachine.policy()` delegates to `policy_for_usage`."""
    m = UsageStateMachine.from_inputs(
        UsageInputs(user_state="anonymous", chat_count=ANON_WALL_FROM, tier="free")
    )
    assert m.policy() == policy_for_usage("free_wall")


def test_thresholds_strictly_ordered() -> None:
    """Boundary sanity — the funnel ratchets monotonically. If anyone
    rewires the constants to a non-monotonic order the derivation will
    misbehave."""
    assert 0 < ANON_SIGNUP_SOFT_FROM < ANON_SIGNUP_HARD_FROM
    assert ANON_SIGNUP_HARD_FROM < ANON_THROTTLED_FROM < ANON_WALL_FROM
    assert 0 < SIGNED_IN_PRO_SOFT_FROM < SIGNED_IN_PRO_HARD_FROM < SIGNED_IN_WALL_FROM


def test_wall_states_set_walled_true_others_false() -> None:
    """Every walled state has `walled=True` and a non-None reason/cta;
    every non-walled state has `walled=False` and `model is not None`."""
    walled_states = {"free_wall", "signed_in_wall"}
    for state in (
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
    ):
        policy = policy_for_usage(state)  # type: ignore[arg-type]
        if state in walled_states:
            assert policy.walled is True
            assert policy.model is None
            assert policy.wall_reason is not None
            assert policy.wall_cta is not None
        else:
            assert policy.walled is False
            assert policy.model is not None
            assert policy.wall_reason is None
            assert policy.wall_cta is None
