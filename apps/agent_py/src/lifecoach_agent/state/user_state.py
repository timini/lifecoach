"""UserStateMachine — auth + Workspace state.

Mirrors `packages/user-state/src/UserStateMachine.ts`.
"""

from __future__ import annotations

from lifecoach_agent.state.policies import policy_for
from lifecoach_agent.state.types import (
    FirebaseUserLike,
    StatePolicy,
    UserEvent,
    UserState,
)

# State → (event → next state). Missing (state, event) pairs are illegal.
_TRANSITIONS: dict[UserState, dict[UserEvent, UserState]] = {
    "anonymous": {
        "EMAIL_SUBMITTED": "email_pending",
        "GOOGLE_LINKED": "google_linked",
        "SIGNED_OUT": "anonymous",
    },
    "email_pending": {
        "EMAIL_VERIFIED": "email_verified",
        "GOOGLE_LINKED": "google_linked",
        "SIGNED_OUT": "anonymous",
    },
    "email_verified": {
        "GOOGLE_LINKED": "google_linked",
        "SIGNED_OUT": "anonymous",
    },
    "google_linked": {
        "WORKSPACE_GRANTED": "workspace_connected",
        "SIGNED_OUT": "anonymous",
    },
    "workspace_connected": {
        "WORKSPACE_REVOKED": "google_linked",
        "SIGNED_OUT": "anonymous",
    },
}


class IllegalTransitionError(Exception):
    """Raised when `send(event)` would not produce a defined transition."""


class UserStateMachine:
    """Tiny mutable wrapper around the transition table — same shape as the
    TS class, including `current()`, `can()`, `send()`, `policy()` and
    `from_firebase_user()`."""

    def __init__(self, initial: UserState = "anonymous") -> None:
        self._state: UserState = initial

    def current(self) -> UserState:
        return self._state

    def can(self, event: UserEvent) -> bool:
        return event in _TRANSITIONS[self._state]

    def send(self, event: UserEvent) -> UserState:
        try:
            nxt = _TRANSITIONS[self._state][event]
        except KeyError as e:
            raise IllegalTransitionError(f"illegal transition: {self._state} --{event}-->") from e
        self._state = nxt
        return nxt

    def policy(self) -> StatePolicy:
        return policy_for(self._state)

    @staticmethod
    def from_firebase_user(user: FirebaseUserLike) -> UserStateMachine:
        """Reconstruct a machine from a Firebase user's auth claims.

        `workspace_scopes_granted` is sourced server-side (from our token
        store), not from the Firebase user itself — pass it in as part of
        the constructed `FirebaseUserLike`.
        """
        if user.is_anonymous:
            return UserStateMachine("anonymous")

        has_google = any(p.provider_id == "google.com" for p in user.provider_data)
        if has_google:
            return UserStateMachine(
                "workspace_connected" if user.workspace_scopes_granted else "google_linked"
            )

        # email/password provider (or link), verified or not
        return UserStateMachine("email_verified" if user.email_verified else "email_pending")
