"""Codex PR #63 follow-up: the `auth_user` tool docstring is what ADK
exposes to the model as the FunctionTool description. If that
description tells the model "use ONLY in the anonymous user state"
while the state directive tells email_pending / email_verified users
to call it on the first workspace ask, the model receives
contradictory instructions and may hesitate or skip the call entirely.

This test pins the docstring contract: it must NOT contain language
that restricts usage to a single state, and it MUST mention the
workspace-trigger flow so the model sees consistent guidance.
"""

from __future__ import annotations

import inspect

from lifecoach_agent.tools.auth_user import auth_user


def test_auth_user_docstring_does_not_restrict_to_anonymous_only() -> None:
    """The original docstring said 'Use ONLY in the anonymous user
    state'. After issue #62 / PR #63 the tool is also the FIRST-turn
    call for email_pending / email_verified on workspace asks. The
    description must not contradict that."""
    doc = inspect.getdoc(auth_user) or ""
    forbidden = [
        "ONLY in the anonymous user state",
        "only in the anonymous user state",
        "Do NOT call this on the first turn",
        "do not call this on the first turn",
    ]
    for phrase in forbidden:
        assert phrase not in doc, (
            f"auth_user docstring contains {phrase!r} which contradicts the "
            f"WORKSPACE-ASK TRIGGER (issue #62) routing email_pending / "
            f"email_verified users to call auth_user on their FIRST "
            f"workspace ask. Remove or rephrase."
        )


def test_auth_user_docstring_mentions_workspace_trigger_flow() -> None:
    """Positive guard: the docstring must describe the second use case
    (workspace trigger) so the model has a clear answer when the
    WORKSPACE-ASK TRIGGER fires."""
    doc = (inspect.getdoc(auth_user) or "").lower()
    assert "workspace" in doc, (
        "auth_user docstring must mention the workspace flow — the "
        "WORKSPACE-ASK TRIGGER routes pre-Google users here on the first "
        "workspace-related request."
    )


def test_auth_user_docstring_explains_google_vs_email_modes() -> None:
    """The model needs to know mode='google' is the workspace path (the
    only one that leads to Workspace scopes)."""
    doc = inspect.getdoc(auth_user) or ""
    assert 'mode="google"' in doc or "mode='google'" in doc
