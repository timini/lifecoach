"""Codex PR #63 P2 regression test: the runtime tool surface must match
the policy spec.

The original bug: `policies.CORE_TOOLS` listed `auth_user` (declaring
it always-available), but `main.py:407` only registered it for
`anonymous`. The WORKSPACE-ASK TRIGGER from issue #62 routes
`email_pending` and `email_verified` users to `auth_user(mode="google")`
on the first workspace request — but they didn't have the tool. Result:
the model either hallucinates the call or falls back to text, defeating
the immediate-trigger fix.

This test pins which states see `auth_user` in their declared policy.
A paired structural check on `main.py` happens via grep in the test
below — if `main.py`'s gate drifts, the literal contents of that line
change and the test fails.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from lifecoach_agent.state import UserState, UserStateMachine

_AGENT_PY_SRC = Path(__file__).resolve().parents[3] / "src" / "lifecoach_agent"


@pytest.mark.parametrize(
    "state",
    ["anonymous", "email_pending", "email_verified"],
)
def test_pre_google_states_have_auth_user_in_policy(state: UserState) -> None:
    """All three pre-Google-sign-in states must have `auth_user` in their
    policy.tools so the WORKSPACE-ASK TRIGGER can fire the OAuth flow."""
    tools = UserStateMachine(state).policy().tools
    assert "auth_user" in tools, (
        f"{state} must have auth_user — the WORKSPACE-ASK TRIGGER routes "
        f"this state to auth_user on workspace asks, and the policy is the "
        f"contract main.py honours when registering tools per turn."
    )


@pytest.mark.parametrize(
    "state",
    ["google_linked", "workspace_connected"],
)
def test_post_google_states_do_not_have_auth_user(state: UserState) -> None:
    """Already-signed-in users should not see auth_user offered — firing
    it would just show the account picker again. They have
    connect_workspace / the six workspace tools instead."""
    tools = UserStateMachine(state).policy().tools
    assert "auth_user" not in tools, f"{state} must not expose auth_user"


def test_main_py_gate_matches_policy_for_auth_user() -> None:
    """Pin the literal `main.py` registration line so a future edit
    that desyncs runtime from policy fails CI loudly.

    Read the source string rather than constructing a real runner —
    real construction requires Firebase / Vertex creds and is the wrong
    surface for a unit test."""
    src = (_AGENT_PY_SRC / "main.py").read_text()
    needle = 'ctx.user_state in ("anonymous", "email_pending", "email_verified")'
    assert needle in src, (
        f"main.py's auth_user gate doesn't match the per-policy spec. "
        f"Expected to find {needle!r}. If the policy is correct, update "
        f"the runtime; if the runtime is correct, update both."
    )
