"""show_capabilities tool — UI-directive only.

The LLM emits this on the first signed-in turn when the user has no
integrations connected yet, and on demand when the user asks "what
can you do". The chat-stream renders a CapabilityPicker organism
inline with three tiles (Workspace, Notion, Career coaching — last
disabled with "Coming soon").

Tile statuses are computed by the closure at registration time —
`workspace_connected` and `notion_connected` flags from the request
context flip the relevant tile's CTA from "Connect" to "Connected ✓".
"""

from __future__ import annotations

from typing import Any

from lifecoach_agent.contracts.models import (
    CapabilityTilePayload,
    ShowCapabilitiesResponse,
)

SHOW_CAPABILITIES_TOOL_NAME = "show_capabilities"


def _build_tiles(
    *, workspace_connected: bool, notion_connected: bool
) -> list[CapabilityTilePayload]:
    return [
        CapabilityTilePayload(
            id="workspace",
            title="Personal assistant",
            body=(
                "Triage your inbox, plan around your calendar, capture quick "
                "tasks straight to Google Tasks."
            ),
            iconKey="workspace",
            status="connected" if workspace_connected else "available",
            cta=None if workspace_connected else "connect_workspace",
        ),
        CapabilityTilePayload(
            id="notion",
            title="Task tracking",
            body=(
                "Keep your TODOs in Notion as a tree of projects + sub-tasks. "
                "I'll keep the notes current as we work."
            ),
            iconKey="notion",
            status="connected" if notion_connected else "available",
            cta=None if notion_connected else "connect_notion",
        ),
        CapabilityTilePayload(
            id="career_coaching",
            title="Career coaching",
            body=(
                "Walk-through exercises and reflective reports for the career "
                "questions on your mind. (Coming soon.)"
            ),
            iconKey="career",
            status="coming_soon",
            cta=None,
        ),
    ]


def create_show_capabilities_tool(
    *,
    workspace_connected: bool = False,
    notion_connected: bool = False,
) -> Any:
    """Return a FunctionTool whose response carries the three-tile
    payload. The closure captures the connect-state flags at /chat
    handler time so the rendered tiles reflect what's live."""

    async def show_capabilities() -> dict[str, Any]:
        """Surface the capability picker in the chat: three tiles
        (Personal assistant / Task tracking / Career coaching) the
        user can act on. Use proactively on first signed-in turn when
        no integrations are connected, and on-demand when the user
        asks 'what can you do' / 'show me your skills'. After calling,
        write a short warm sentence to introduce the choices — the
        picker itself does the heavy lifting."""
        tiles = _build_tiles(
            workspace_connected=workspace_connected,
            notion_connected=notion_connected,
        )
        return ShowCapabilitiesResponse(capabilities=tiles).model_dump()

    from google.adk.tools import FunctionTool  # noqa: PLC0415

    return FunctionTool(show_capabilities)
