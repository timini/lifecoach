from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest
from google.adk.events import Event
from google.genai import types

from lifecoach_agent.workspace_agent.bridged_agent_tool import BridgedAgentTool


class _SessionService:
    def __init__(self) -> None:
        self.events: list[Event] = []

    async def append_event(self, *, session: Any, event: Event) -> Event:
        self.events.append(event)
        return event


def _make_bridged_tool() -> BridgedAgentTool:
    agent = SimpleNamespace(name="triage_inbox", description="triage gmail")
    return BridgedAgentTool(agent=agent)  # type: ignore[arg-type]


def _tool_context(session_service: _SessionService) -> Any:
    invocation = SimpleNamespace(
        invocation_id="parent-invocation",
        agent=SimpleNamespace(name="triage_inbox"),
        branch=None,
        session_service=session_service,
        session=SimpleNamespace(),
    )
    return SimpleNamespace(
        function_call_id="parent-call",
        _invocation_context=invocation,
    )


@pytest.mark.asyncio
async def test_bridged_function_response_uses_user_role() -> None:
    """ADK/Gemini convention: function_response parts live in role='user'
    content. Bridging them under role='model' makes a later /history
    reload surface a model message containing functionResponse parts,
    which Gemini rejects as invalid input."""

    session_service = _SessionService()
    tool = _make_bridged_tool()
    inner = Event(
        invocation_id="inner",
        author="triage_inbox",
        content=types.Content(
            role="user",
            parts=[types.Part.from_function_response(name="list_inbox", response={"status": "ok"})],
        ),
    )

    await tool._bridge_inner_tool_event(inner, _tool_context(session_service))

    assert len(session_service.events) == 1
    assert session_service.events[0].content.role == "user"


@pytest.mark.asyncio
async def test_bridged_function_call_uses_model_role() -> None:
    """Function-call parts must stay under role='model'."""

    session_service = _SessionService()
    tool = _make_bridged_tool()
    inner = Event(
        invocation_id="inner",
        author="triage_inbox",
        content=types.Content(
            role="model",
            parts=[types.Part.from_function_call(name="list_inbox", args={"since": "1d"})],
        ),
    )

    await tool._bridge_inner_tool_event(inner, _tool_context(session_service))

    assert len(session_service.events) == 1
    assert session_service.events[0].content.role == "model"
