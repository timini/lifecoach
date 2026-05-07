"""upgrade_to_pro tool — UI-directive only.

Surfaces an UpgradePrompt card to the web. The LLM never sees billing
identifiers or values — same auth-plane boundary as connect_workspace.
"""

from __future__ import annotations

from typing import Any

UPGRADE_TO_PRO_TOOL_NAME = "upgrade_to_pro"


async def upgrade_to_pro() -> dict[str, Any]:
    """Surface a Lifecoach Pro upgrade card to the user. Use sparingly —
    at most once per session, and only when the conversation has just hit
    a moment where Pro would genuinely help (deeper analysis, faster
    replies, no daily nudges). After calling, write NO additional text
    that turn — the upgrade card is the entire response. Do NOT attempt
    to handle any payment values yourself; the application handles
    billing if and when the user opts in."""
    return {"status": "upgrade_prompted"}


def create_upgrade_to_pro_tool() -> Any:
    from google.adk.tools import FunctionTool

    return FunctionTool(upgrade_to_pro)
