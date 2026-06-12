"""connect_notion tool — UI-directive only.

The LLM emits this when the user is at-least email_verified and the
conversation would benefit from Notion task management. The browser
opens Notion's authorize URL in a popup; the application server
exchanges the code and stores the resulting tokens.

The LLM is NEVER involved in auth — no args carry tokens, no response
carries codes. Same boundary as connect_workspace + auth_user.
"""

from __future__ import annotations

from typing import Any

CONNECT_NOTION_TOOL_NAME = "connect_notion"


async def connect_notion() -> dict[str, Any]:
    """Prompt the user to grant Notion access so you can manage their
    Lifecoach Tasks database — list / add / update / re-parent /
    complete tasks. Use when their goal needs task-management capability
    and they have not yet connected Notion. After calling, write NO
    additional text that turn — the connect prompt is the entire
    response. Do NOT attempt to handle tokens, codes, or secrets
    yourself; the application handles the OAuth flow."""
    return {"status": "oauth_prompted", "provider": "notion"}


def create_connect_notion_tool() -> Any:
    from google.adk.tools import FunctionTool  # noqa: PLC0415

    return FunctionTool(connect_notion)
