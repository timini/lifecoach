"""Shapes shared by the state machines and consumers (server + tools).

Mirrors `packages/user-state/src/types.ts` exactly. Kept minimal — no
Firebase SDK types leak into this module. The structural `FirebaseUserLike`
shape is the contract; the server hands one in, the agent never imports
firebase-admin types here.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

# The agent's coarse-grained auth + Workspace state. Drives both tool
# registration (see `policies.policy_for`) and the "this user is X" line
# in the system prompt.
UserState = Literal[
    "anonymous",
    "email_pending",
    "email_verified",
    "google_linked",
    "workspace_connected",
]

# Events that may transition a UserState. See `user_state.UserStateMachine`.
UserEvent = Literal[
    "EMAIL_SUBMITTED",
    "EMAIL_VERIFIED",
    "GOOGLE_LINKED",
    "WORKSPACE_GRANTED",
    "WORKSPACE_REVOKED",
    "SIGNED_OUT",
]

# Canonical agent tool names. The state machine decides which subset to
# register with the ADK agent for each state. Matches the Zod-side enum.
ToolName = Literal[
    "update_user_profile",
    "log_goal_update",
    "ask_single_choice_question",
    "ask_multiple_choice_question",
    "auth_user",
    "google_search",
    "memory_search",
    "memory_save",
    "connect_workspace",
    # Workspace surface (workspace_connected only). 2 AgentTools wrapping
    # the workspace sub-agent + 6 narrow write FunctionTools.
    "triage_inbox",
    "find_workspace",
    "archive_messages",
    "add_calendar_event",
    "edit_calendar_event",
    "delete_calendar_event",
    "add_task",
    "complete_task",
    "upgrade_to_pro",
]

# Discriminated union of UI affordances the web app may render. New kinds
# are cheap to add — widen the union and the renderer's switch.
UIAffordance = Literal[
    "share_location_button",
    "save_progress_suggestion",
    "resend_verification_button",
    "sign_in_with_google_button",
    "connect_workspace_button",
    "workspace_connected_indicator",
]


@dataclass(frozen=True)
class StatePolicy:
    state: UserState
    tools: tuple[ToolName, ...]
    directive: str
    ui_affordances: tuple[dict[str, str], ...]


@dataclass(frozen=True)
class FirebaseProvider:
    provider_id: str


@dataclass(frozen=True)
class FirebaseUserLike:
    """Minimal shape we read from a Firebase user object — a structural
    subset so we don't take a dependency on firebase-admin in this module.
    """

    is_anonymous: bool
    email_verified: bool
    provider_data: tuple[FirebaseProvider, ...]
    workspace_scopes_granted: bool = False
