"""connect_workspace tool — UI-directive only.

The LLM emits this when the user is google_linked but not yet
workspace_connected and the conversation would benefit. The browser
drives the GIS popup; the application server exchanges/stores tokens.

The LLM is **never** involved in auth — no args carry tokens, no
response carries codes. Same boundary as auth_user.
"""

from __future__ import annotations

from typing import Any

CONNECT_WORKSPACE_TOOL_NAME = "connect_workspace"


async def connect_workspace() -> dict[str, Any]:
    """Prompt the user to grant Google Workspace access (Gmail, Calendar,
    Tasks) so you can read/send email, manage calendar, and manage tasks
    on their behalf. Use when their goal needs workspace capability and
    they have not yet granted it. After calling, write NO additional text
    that turn — the connect prompt is the entire response. Do NOT attempt
    to handle any tokens, codes, or secrets yourself; the application
    handles the OAuth flow."""
    return {"status": "oauth_prompted"}


def create_connect_workspace_tool() -> Any:
    from google.adk.tools import FunctionTool

    return FunctionTool(connect_workspace)
