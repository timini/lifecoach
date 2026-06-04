"""Mirrors `packages/user-state/src/UserStateMachine.test.ts`."""

from __future__ import annotations

import re

import pytest

from lifecoach_agent.state import (
    FirebaseProvider,
    FirebaseUserLike,
    IllegalTransitionError,
    UserEvent,
    UserState,
    UserStateMachine,
)

ALL_STATES: tuple[UserState, ...] = (
    "anonymous",
    "email_pending",
    "email_verified",
    "google_linked",
    "workspace_connected",
)
ALL_EVENTS: tuple[UserEvent, ...] = (
    "EMAIL_SUBMITTED",
    "EMAIL_VERIFIED",
    "GOOGLE_LINKED",
    "WORKSPACE_GRANTED",
    "WORKSPACE_REVOKED",
    "SIGNED_OUT",
)

LEGAL_TRANSITIONS: list[tuple[UserState, UserEvent, UserState]] = [
    ("anonymous", "EMAIL_SUBMITTED", "email_pending"),
    ("email_pending", "EMAIL_VERIFIED", "email_verified"),
    ("anonymous", "GOOGLE_LINKED", "google_linked"),
    ("email_pending", "GOOGLE_LINKED", "google_linked"),
    ("email_verified", "GOOGLE_LINKED", "google_linked"),
    ("google_linked", "WORKSPACE_GRANTED", "workspace_connected"),
    ("workspace_connected", "WORKSPACE_REVOKED", "google_linked"),
    ("anonymous", "SIGNED_OUT", "anonymous"),
    ("email_pending", "SIGNED_OUT", "anonymous"),
    ("email_verified", "SIGNED_OUT", "anonymous"),
    ("google_linked", "SIGNED_OUT", "anonymous"),
    ("workspace_connected", "SIGNED_OUT", "anonymous"),
]


@pytest.mark.parametrize(("from_", "event", "to"), LEGAL_TRANSITIONS)
def test_legal_transitions(from_: UserState, event: UserEvent, to: UserState) -> None:
    m = UserStateMachine(from_)
    assert m.can(event) is True
    assert m.send(event) == to
    assert m.current() == to


def test_illegal_transitions_throw() -> None:
    legal = {(f, e) for (f, e, _) in LEGAL_TRANSITIONS}
    for from_ in ALL_STATES:
        for event in ALL_EVENTS:
            if (from_, event) in legal:
                continue
            m = UserStateMachine(from_)
            assert m.can(event) is False
            with pytest.raises(
                IllegalTransitionError, match=re.compile(r"illegal transition", re.I)
            ):
                m.send(event)
            assert m.current() == from_


# --- policy() per state --------------------------------------------------


def test_anonymous_only_core_tools_and_share_location() -> None:
    p = UserStateMachine("anonymous").policy()
    assert "triage_inbox" not in p.tools
    assert "archive_messages" not in p.tools
    assert "connect_workspace" not in p.tools
    assert {"kind": "share_location_button"} in p.ui_affordances
    assert {"kind": "save_progress_suggestion"} in p.ui_affordances
    assert re.search(r"anonymous", p.directive, re.I)


def test_workspace_connected_is_only_state_with_workspace_tools() -> None:
    workspace_tools = {
        "triage_inbox",
        "find_workspace",
        "archive_messages",
        "add_calendar_event",
        "edit_calendar_event",
        "delete_calendar_event",
        "add_task",
        "complete_task",
    }
    states_with_workspace = [
        UserStateMachine(s).policy().state
        for s in ALL_STATES
        if workspace_tools & set(UserStateMachine(s).policy().tools)
    ]
    assert states_with_workspace == ["workspace_connected"]
    # And workspace_connected exposes ALL eight.
    ws_tools = set(UserStateMachine("workspace_connected").policy().tools)
    assert workspace_tools.issubset(ws_tools)


def test_google_linked_and_workspace_connected_expose_connect_workspace() -> None:
    for s in ("google_linked", "workspace_connected"):
        p = UserStateMachine(s).policy()
        assert "connect_workspace" in p.tools
    for s in ("anonymous", "email_pending", "email_verified"):
        p = UserStateMachine(s).policy()
        assert "connect_workspace" not in p.tools


def test_each_state_has_non_empty_directive() -> None:
    for s in ALL_STATES:
        directive = UserStateMachine(s).policy().directive
        assert len(directive) > 30


# --- from_firebase_user --------------------------------------------------


def test_from_firebase_anonymous() -> None:
    m = UserStateMachine.from_firebase_user(
        FirebaseUserLike(is_anonymous=True, email_verified=False, provider_data=())
    )
    assert m.current() == "anonymous"


def test_from_firebase_password_unverified() -> None:
    m = UserStateMachine.from_firebase_user(
        FirebaseUserLike(
            is_anonymous=False,
            email_verified=False,
            provider_data=(FirebaseProvider("password"),),
        )
    )
    assert m.current() == "email_pending"


def test_from_firebase_password_verified() -> None:
    m = UserStateMachine.from_firebase_user(
        FirebaseUserLike(
            is_anonymous=False,
            email_verified=True,
            provider_data=(FirebaseProvider("password"),),
        )
    )
    assert m.current() == "email_verified"


def test_from_firebase_google_no_workspace() -> None:
    m = UserStateMachine.from_firebase_user(
        FirebaseUserLike(
            is_anonymous=False,
            email_verified=True,
            provider_data=(FirebaseProvider("google.com"),),
        )
    )
    assert m.current() == "google_linked"


def test_from_firebase_google_with_workspace() -> None:
    m = UserStateMachine.from_firebase_user(
        FirebaseUserLike(
            is_anonymous=False,
            email_verified=True,
            provider_data=(FirebaseProvider("google.com"),),
            workspace_scopes_granted=True,
        )
    )
    assert m.current() == "workspace_connected"
