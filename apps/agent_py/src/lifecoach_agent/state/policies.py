"""Per-UserState policy: which tools are registered, the state-specific
directive appended to the system prompt, and the UI affordances the web
client renders.

Mirrors `packages/user-state/src/policies.ts`.
"""

from __future__ import annotations

from typing import Final

from lifecoach_agent.state.types import StatePolicy, ToolName, UIAffordance, UserState

# Tools every state always has (writes + UI directives). State-specific
# additions come from `_STATE_ADDITIONAL_TOOLS`.
CORE_TOOLS: Final[tuple[ToolName, ...]] = (
    "update_user_profile",
    "log_goal_update",
    "ask_single_choice_question",
    "ask_multiple_choice_question",
    "auth_user",
    "google_search",
    "memory_search",
    "memory_save",
)


_STATE_ADDITIONAL_TOOLS: dict[UserState, tuple[ToolName, ...]] = {
    "anonymous": (),
    "email_pending": (),
    "email_verified": (),
    # google_linked users can invite themselves to upgrade — the LLM
    # emits `connect_workspace` (UI directive, no auth handling) to
    # trigger the browser's GIS popup.
    "google_linked": ("connect_workspace",),
    # workspace_connected users get the full Google Workspace surface
    # exported by `workspace_agent` (2 AgentTools wrapping the workspace
    # sub-agent + 4 narrow write FunctionTools). The canonical list is
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
        "add_task",
        "complete_task",
        "connect_workspace",
    ),
}


_STATE_DIRECTIVE: dict[UserState, str] = {
    "anonymous": (
        "User is anonymous (no email, no Google sign-in). After ~6 meaningful "
        "exchanges, naturally suggest saving progress by sharing email or signing "
        "in with Google — but do not push early and never nag. Their data is not "
        "persisted across sessions yet."
    ),
    "email_pending": (
        "User submitted their email but has not clicked the verification link. "
        "Mention verification once, gently, if natural. Do not repeat the reminder."
    ),
    "email_verified": (
        "User is identified by a verified email. Their progress is saved. Offer "
        "Google sign-in only when it unlocks something specific the user wants "
        "(e.g., calendar, drive)."
    ),
    "google_linked": (
        "User is signed in with Google but has not granted Workspace access. "
        "Offer Workspace connection only when the conversation would genuinely "
        "benefit (calendar context, checking email, finding a file)."
    ),
    "workspace_connected": (
        "User granted Google Workspace access. Use the six workspace tools "
        "(triage_inbox, find_workspace, archive_messages, add_calendar_event, "
        "add_task, complete_task) when the user asks something that requires "
        "their workspace. Never speculate about their workspace contents — "
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
