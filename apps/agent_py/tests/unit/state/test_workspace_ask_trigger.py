"""Issue #62 regression test.

Every non-`workspace_connected` state directive must contain the
WORKSPACE-ASK TRIGGER block — the turn-1 auth/connect rule for
workspace-related asks. A future prompt edit that "tones it down" or
removes the explicit FIRST-reply / no-clarification language would
silently re-introduce the four-turn clarification regression we hit
on 2026-05-11. This test makes that revert loud.

The exact wording is a moving target as we tune; the test pins down
the load-bearing pieces:
- the marker string ``WORKSPACE-ASK TRIGGER`` is present
- the directive names the right tool (`auth_user` for pre-sign-in
  states, `connect_workspace` for `google_linked`)
- the directive says "FIRST" and "tool call" so the model knows the
  call replaces the reply
"""

from __future__ import annotations

import pytest

from lifecoach_agent.state import UserState, UserStateMachine

_PRE_SIGNIN_STATES: tuple[UserState, ...] = (
    "anonymous",
    "email_pending",
    "email_verified",
)


@pytest.mark.parametrize("state", _PRE_SIGNIN_STATES)
def test_pre_signin_states_trigger_auth_user(state: UserState) -> None:
    directive = UserStateMachine(state).policy().directive
    assert "WORKSPACE-ASK TRIGGER" in directive, (
        f"{state} directive is missing the WORKSPACE-ASK TRIGGER block — "
        "the turn-1 auth-trigger regression guard. See issue #62."
    )
    assert "auth_user" in directive
    assert 'mode="google"' in directive or "mode='google'" in directive
    assert "FIRST" in directive


def test_google_linked_triggers_connect_workspace() -> None:
    directive = UserStateMachine("google_linked").policy().directive
    assert "WORKSPACE-ASK TRIGGER" in directive
    assert "connect_workspace" in directive
    assert "FIRST" in directive
    # Must not tell the model to call auth_user — user is already signed in.
    assert "auth_user" not in directive


def test_workspace_connected_has_no_trigger_block() -> None:
    """The trigger is for the disconnected states only. `workspace_connected`
    has the actual tools — it should never see the auth/connect rule."""
    directive = UserStateMachine("workspace_connected").policy().directive
    assert "WORKSPACE-ASK TRIGGER" not in directive
    # Sanity: it should still mention the actual workspace tools.
    assert "triage_inbox" in directive


def test_trigger_explicitly_bans_clarifying_questions() -> None:
    """Issue #62: the original failure was the agent asking clarifying
    questions instead of triggering the auth flow. Lock in the
    no-clarification language."""
    for state in (*_PRE_SIGNIN_STATES, "google_linked"):
        directive = UserStateMachine(state).policy().directive
        assert "clarifying questions" in directive.lower(), (
            f"{state} directive must explicitly ban clarifying questions"
        )
