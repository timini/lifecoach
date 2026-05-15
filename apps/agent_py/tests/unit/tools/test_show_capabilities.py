"""Tests for the `show_capabilities` UI directive — verifies the
3-tile payload + per-status CTA dispatch."""

from __future__ import annotations

import pytest

from lifecoach_agent.contracts.models import ShowCapabilitiesResponse
from lifecoach_agent.tools.show_capabilities import create_show_capabilities_tool


@pytest.mark.asyncio
async def test_no_integrations_connected_both_show_available() -> None:
    tool = create_show_capabilities_tool(workspace_connected=False, notion_connected=False)
    response = ShowCapabilitiesResponse.model_validate(await tool.func())
    by_id = {t.id: t for t in response.capabilities}
    assert by_id["workspace"].status == "available"
    assert by_id["workspace"].cta == "connect_workspace"
    assert by_id["notion"].status == "available"
    assert by_id["notion"].cta == "connect_notion"
    assert by_id["career_coaching"].status == "coming_soon"
    assert by_id["career_coaching"].cta is None


@pytest.mark.asyncio
async def test_workspace_connected_drops_workspace_cta() -> None:
    tool = create_show_capabilities_tool(workspace_connected=True, notion_connected=False)
    response = ShowCapabilitiesResponse.model_validate(await tool.func())
    by_id = {t.id: t for t in response.capabilities}
    assert by_id["workspace"].status == "connected"
    assert by_id["workspace"].cta is None
    # Notion still available.
    assert by_id["notion"].status == "available"
    assert by_id["notion"].cta == "connect_notion"


@pytest.mark.asyncio
async def test_both_connected_only_career_coaching_remains_actionable() -> None:
    """Edge case: even when both real integrations are connected, the
    picker still renders all three tiles. Career coaching stays
    coming_soon; the connected ones show a ✓."""
    tool = create_show_capabilities_tool(workspace_connected=True, notion_connected=True)
    response = ShowCapabilitiesResponse.model_validate(await tool.func())
    statuses = {t.id: t.status for t in response.capabilities}
    assert statuses == {
        "workspace": "connected",
        "notion": "connected",
        "career_coaching": "coming_soon",
    }


@pytest.mark.asyncio
async def test_tile_order_is_stable() -> None:
    """Order matters for the chat-stream organism: workspace first,
    notion second, career third — matches the chat narrative arc
    (personal-assistant capability is the legacy default)."""
    tool = create_show_capabilities_tool(workspace_connected=False, notion_connected=False)
    response = ShowCapabilitiesResponse.model_validate(await tool.func())
    assert [t.id for t in response.capabilities] == [
        "workspace",
        "notion",
        "career_coaching",
    ]


@pytest.mark.asyncio
async def test_tile_titles_use_user_facing_coaching_language() -> None:
    """Per the user-facing-naming memory: tiles use human language,
    not engineering jargon. No 'sub-agent' / 'module' / 'plugin'
    leakage."""
    tool = create_show_capabilities_tool(workspace_connected=False, notion_connected=False)
    response = ShowCapabilitiesResponse.model_validate(await tool.func())
    for t in response.capabilities:
        title_lc = t.title.lower()
        for forbidden in ("sub-agent", "module", "plugin", "skill"):
            assert forbidden not in title_lc, f"engineering jargon leaked: {t.title}"
