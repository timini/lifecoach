"""Smoke tests for the `connect_notion` UI directive."""

from __future__ import annotations

import pytest

from lifecoach_agent.tools.connect_notion import (
    CONNECT_NOTION_TOOL_NAME,
    connect_notion,
    create_connect_notion_tool,
)


@pytest.mark.asyncio
async def test_returns_oauth_prompted_with_provider() -> None:
    result = await connect_notion()
    assert result == {"status": "oauth_prompted", "provider": "notion"}


def test_factory_wraps_in_function_tool() -> None:
    tool = create_connect_notion_tool()
    # ADK's FunctionTool exposes the underlying callable via `.func`.
    assert tool.func is connect_notion
    assert tool.name == CONNECT_NOTION_TOOL_NAME
