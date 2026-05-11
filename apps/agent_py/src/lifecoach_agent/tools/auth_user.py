"""auth_user tool — surfaces a sign-in UI directive to the frontend.

UI-directive only. The actual `linkWithPopup` / email-link call happens
in the browser against the Firebase Auth client SDK. The LLM never sees
codes, tokens, or refreshes — see memory/feedback_agent_never_sees_tokens.md.
"""

from __future__ import annotations

from typing import Any

from lifecoach_agent.contracts import AUTH_USER_TOOL_NAME, AuthMode  # noqa: F401


async def auth_user(mode: str, email: str | None = None) -> dict[str, Any]:
    """Surface a sign-in UI prompt to the user. Used in two flows:

    1. SAVING PROGRESS (anonymous users only): after several meaningful
       turns, when the user has shared enough that losing it on device
       change would frustrate them. Do NOT lead with this on turn 1.

    2. UNLOCKING WORKSPACE ACCESS (anonymous / email_pending /
       email_verified — see WORKSPACE-ASK TRIGGER in the system prompt):
       the moment the user asks for ANYTHING needing Google Workspace
       (read/triage email, calendar today, list/add/complete tasks),
       call this on the FIRST turn with mode="google". No clarifying
       questions; the OAuth widget IS the reply. Workspace scopes are a
       separate grant via `connect_workspace` once the user reaches
       `google_linked` — the user only needs to be told they're signing
       in first.

    After calling, write NO additional text that turn — the sign-in
    prompt is the entire response.

    Args:
        mode: How to upgrade. "google" = one-click Google sign-in
            (required for the WORKSPACE flow); "email" = email magic-link
            (only useful for the saving-progress flow).
        email: Only for mode="email". If you already know the user's
            email, pass it; otherwise omit and the UI will ask.
    """
    out: dict[str, Any] = {"status": "auth_prompted", "mode": mode}
    if email:
        out["email"] = email
    return out


def create_auth_user_tool() -> Any:
    """Wrap the underlying `auth_user` callable as an ADK FunctionTool.
    Lazy import so callers (e.g. eval/test code) can use the raw callable
    without pulling in `google-adk` at import time."""
    from google.adk.tools import FunctionTool

    return FunctionTool(auth_user)
