from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from lifecoach_agent.web_research import (
    WEB_RESEARCH_TOOL_NAME,
    create_web_research_tool,
)


@pytest.mark.asyncio
async def test_web_research_tool_is_search_only_and_propagates_grounding() -> None:
    tool = create_web_research_tool(model="gemini-3.7-flash")

    assert tool.name == WEB_RESEARCH_TOOL_NAME
    assert tool.propagate_grounding_metadata is True
    assert tool.agent.model == "gemini-3.7-flash"
    assert [child_tool.name for child_tool in tool.agent.tools] == ["google_search"]
    assert "untrusted data" in tool.agent.instruction
    assert "could not be verified" in tool.agent.instruction


@pytest.mark.asyncio
async def test_web_research_deadline_returns_honest_structured_error() -> None:
    async def slow_search(*_args: object, **_kwargs: object) -> str:
        await asyncio.sleep(1)
        return "late"

    tool = create_web_research_tool(model="gemini-3.7-flash", timeout_s=0.01)
    with patch("google.adk.tools.agent_tool.AgentTool.run_async", slow_search):
        raw = await tool.run_async(args={"request": "latest"}, tool_context=SimpleNamespace())

    assert json.loads(raw) == {
        "status": "error",
        "code": "timeout",
        "message": "Current web results could not be verified in time.",
    }
