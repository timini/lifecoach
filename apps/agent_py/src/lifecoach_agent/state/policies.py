"""Per-UserState policy: which tools are registered, the state-specific
directive appended to the system prompt, and the UI affordances the web
client renders.

Mirrors `packages/user-state/src/policies.ts`.
"""

from __future__ import annotations

from typing import Final

from lifecoach_agent.state.types import StatePolicy, ToolName, UIAffordance, UserState

# Tools every state always has (writes + UI directives). State-specific
# additions come from `_STATE_ADDITIONAL_TOOLS`. Note: `auth_user` lives
# in the per-state list (not here) — it's only meaningful for users who
# haven't yet signed in with Google.
CORE_TOOLS: Final[tuple[ToolName, ...]] = (
    "update_user_profile",
    "log_goal_update",
    "ask_single_choice_question",
    "ask_multiple_choice_question",
    "google_search",
    "memory_search",
    "memory_save",
)


# `auth_user({mode:"google"})` triggers the Google sign-in flow. Useful
# only for the three pre-Google-sign-in states; firing it for a user
# who's already on `google_linked` / `workspace_connected` would just
# show the account picker again (confusing UX). The WORKSPACE-ASK
# TRIGGER directive routes these states to `auth_user` as the FIRST
# turn on workspace requests — registering the tool here is what makes
# that directive runnable.
_PRE_GOOGLE_AUTH_TOOLS: tuple[ToolName, ...] = ("auth_user",)


_STATE_ADDITIONAL_TOOLS: dict[UserState, tuple[ToolName, ...]] = {
    "anonymous": _PRE_GOOGLE_AUTH_TOOLS,
    "email_pending": _PRE_GOOGLE_AUTH_TOOLS,
    "email_verified": _PRE_GOOGLE_AUTH_TOOLS,
    # google_linked users can invite themselves to upgrade — the LLM
    # emits `connect_workspace` (UI directive, no auth handling) to
    # trigger the browser's GIS popup.
    "google_linked": ("connect_workspace",),
    # workspace_connected users get the full Google Workspace surface
    # exported by `workspace_agent` (2 AgentTools wrapping the workspace
    # sub-agent + 6 narrow write FunctionTools). The canonical list is
    # `lifecoach_agent.workspace_agent.WORKSPACE_TOOL_NAMES`; this tuple
    # must match it 1:1 + `connect_workspace`. A drift test in
    # `tests/unit/state/test_policies_workspace_drift.py` keeps them in
    # sync — we duplicate the names here (rather than import the source
    # of truth) to avoid a `state → workspace_agent → storage → state`
    # circular import.
    "workspace_connected": (
        "triage_inbox",
        "find_workspace",
        "archive_messages",
        "add_calendar_event",
        "edit_calendar_event",
        "delete_calendar_event",
        "add_task",
        "complete_task",
        "connect_workspace",
    ),
}


_WORKSPACE_ASK_TRIGGER_ANON = (
    "WORKSPACE-ASK TRIGGER (CRITICAL — turn-ending behaviour): if the user "
    "asks for ANYTHING that requires Google Workspace access — reading or "
    "triaging email, checking calendar, listing or completing tasks, adding "
    'events — your FIRST reply must call `auth_user` with `mode="google"`. '
    "Do not ask clarifying questions, do not propose strategies, do not "
    "explore intent. Say nothing before the tool call; the auth widget IS "
    "the turn. Workspace access requires signing in with Google first, then "
    "granting Workspace scopes — the auth_user tool handles step one."
)

_WORKSPACE_ASK_TRIGGER_GOOGLE_LINKED = (
    "WORKSPACE-ASK TRIGGER (CRITICAL — turn-ending behaviour): if the user "
    "asks for ANYTHING that requires Google Workspace access — reading or "
    "triaging email, checking calendar, listing or completing tasks, adding "
    "events — your FIRST reply must call `connect_workspace`. Do not ask "
    "clarifying questions, do not propose strategies, do not explore intent. "
    "Say nothing before the tool call; the connect widget IS the turn. The "
    "user is already signed in with Google; they just need to grant "
    "Workspace scopes."
)


_STATE_DIRECTIVE: dict[UserState, str] = {
    "anonymous": (
        "User is anonymous (no email, no Google sign-in). After ~6 meaningful "
        "exchanges, naturally suggest saving progress by sharing email or signing "
        "in with Google — but do not push early and never nag. Their data is not "
        "persisted across sessions yet.\n\n" + _WORKSPACE_ASK_TRIGGER_ANON
    ),
    "email_pending": (
        "User submitted their email but has not clicked the verification link. "
        "Mention verification once, gently, if natural. Do not repeat the "
        "reminder.\n\n" + _WORKSPACE_ASK_TRIGGER_ANON
    ),
    "email_verified": (
        "User is identified by a verified email. Their progress is saved. Offer "
        "Google sign-in only when it unlocks something specific the user wants "
        "(e.g., calendar, drive).\n\n" + _WORKSPACE_ASK_TRIGGER_ANON
    ),
    "google_linked": (
        "User is signed in with Google but has not granted Workspace access. "
        "Workspace connection is the next step when it would genuinely benefit "
        "the conversation.\n\n" + _WORKSPACE_ASK_TRIGGER_GOOGLE_LINKED
    ),
    "workspace_connected": (
        "User granted Google Workspace access. Use the eight workspace tools "
        "(triage_inbox, find_workspace, archive_messages, add_calendar_event, "
        "edit_calendar_event, delete_calendar_event, add_task, complete_task) "
        "when the user asks something that requires their workspace. Never speculate about their workspace contents — "
        "call the tool."
    ),
}


def _ui(*kinds: UIAffordance) -> tuple[dict[str, str], ...]:
    return tuple({"kind": k} for k in kinds)


_STATE_UI: dict[UserState, tuple[dict[str, str], ...]] = {
    "anonymous": _ui("share_location_button", "save_progress_suggestion"),
    "email_pending": _ui("resend_verification_button"),
    "email_verified": _ui("sign_in_with_google_button"),
    "google_linked": _ui("connect_workspace_button"),
    "workspace_connected": _ui("workspace_connected_indicator"),
}


def policy_for(state: UserState) -> StatePolicy:
    """Return the StatePolicy for the given UserState — pure function,
    safe to call per turn."""
    return StatePolicy(
        state=state,
        tools=tuple(CORE_TOOLS) + _STATE_ADDITIONAL_TOOLS[state],
        directive=_STATE_DIRECTIVE[state],
        ui_affordances=_STATE_UI[state],
    )
