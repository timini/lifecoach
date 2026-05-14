from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest
from google.adk.events import Event
from google.genai import types

from lifecoach_agent.workspace_agent.bridged_agent_tool import (
    _bridge_inner_event,
    reset_workspace_event_sink,
    set_workspace_event_sink,
)


class _SessionService:
    def __init__(self) -> None:
        self.events: list[Event] = []

    async def append_event(self, *, session: Any, event: Event) -> Event:
        self.events.append(event)
        return event


@pytest.mark.asyncio
async def test_bridge_inner_function_call_persists_and_streams_partial_call() -> None:
    session_service = _SessionService()
    invocation = SimpleNamespace(
        invocation_id="parent-invocation",
        agent=SimpleNamespace(name="lifecoach"),
        branch=None,
        session_service=session_service,
        session=SimpleNamespace(),
    )
    tool_context = SimpleNamespace(
        function_call_id="parent-call",
        _invocation_context=invocation,
    )
    inner = Event(
        invocation_id="inner-invocation",
        author="triage_inbox",
        content=types.Content(
            role="model",
            parts=[types.Part.from_function_call(name="list_inbox", args={"since": "1d"})],
        ),
    )
    inner.content.parts[0].function_call.id = "inner-call"

    streamed: list[Event] = []
    token = set_workspace_event_sink(lambda event: _append(streamed, event))
    try:
        await _bridge_inner_event(inner, tool_context=tool_context)  # type: ignore[arg-type]
    finally:
        reset_workspace_event_sink(token)

    assert len(session_service.events) == 1
    persisted_call = session_service.events[0].content.parts[0].function_call
    assert session_service.events[0].author == "lifecoach"
    assert persisted_call.name == "list_inbox"
    assert persisted_call.id == "parent-call:inner-call"
    assert persisted_call.args == {"since": "1d"}
    assert session_service.events[0].partial is None

    assert len(streamed) == 1
    assert streamed[0].partial is True
    assert streamed[0].content.parts[0].function_call.id == "parent-call:inner-call"


@pytest.mark.asyncio
async def test_bridge_inner_function_response_uses_matching_bridged_id() -> None:
    session_service = _SessionService()
    invocation = SimpleNamespace(
        invocation_id="parent-invocation",
        agent=SimpleNamespace(name="lifecoach"),
        branch=None,
        session_service=session_service,
        session=SimpleNamespace(),
    )
    tool_context = SimpleNamespace(
        function_call_id="parent-call",
        _invocation_context=invocation,
    )
    inner = Event(
        invocation_id="inner-invocation",
        author="triage_inbox",
        content=types.Content(
            role="user",
            parts=[
                types.Part.from_function_response(
                    name="list_inbox", response={"status": "ok", "messages": []}
                )
            ],
        ),
    )
    inner.content.parts[0].function_response.id = "inner-call"

    streamed: list[Event] = []
    token = set_workspace_event_sink(lambda event: _append(streamed, event))
    try:
        await _bridge_inner_event(inner, tool_context=tool_context)  # type: ignore[arg-type]
    finally:
        reset_workspace_event_sink(token)

    assert len(session_service.events) == 1
    persisted_response = session_service.events[0].content.parts[0].function_response
    assert persisted_response.name == "list_inbox"
    assert persisted_response.id == "parent-call:inner-call"
    # `messages` is stripped — the badge only needs status, not the payload.
    assert persisted_response.response == {"status": "ok"}
    assert session_service.events[0].partial is None

    assert len(streamed) == 1
    assert streamed[0].partial is None
    assert streamed[0].content.parts[0].function_response.id == "parent-call:inner-call"


@pytest.mark.asyncio
async def test_bridge_redacts_bulky_inner_response_payload() -> None:
    """Inner workspace tools may return decoded email bodies (up to 4 KB).
    Bridging the raw payload would leak that content over SSE and persist
    it as the parent tool-badge response. Only the success/error scalars
    should survive the bridge."""

    session_service = _SessionService()
    invocation = SimpleNamespace(
        invocation_id="parent-invocation",
        agent=SimpleNamespace(name="lifecoach"),
        branch=None,
        session_service=session_service,
        session=SimpleNamespace(),
    )
    tool_context = SimpleNamespace(
        function_call_id="parent-call",
        _invocation_context=invocation,
    )
    inner = Event(
        invocation_id="inner-invocation",
        author="triage_inbox",
        content=types.Content(
            role="user",
            parts=[
                types.Part.from_function_response(
                    name="get_message",
                    response={
                        "status": "ok",
                        "message": {
                            "subject": "private",
                            "body": "secret email body content",
                            "headers": {"From": "alice@example.com"},
                        },
                    },
                )
            ],
        ),
    )
    inner.content.parts[0].function_response.id = "inner-call"

    streamed: list[Event] = []
    token = set_workspace_event_sink(lambda event: _append(streamed, event))
    try:
        await _bridge_inner_event(inner, tool_context=tool_context)  # type: ignore[arg-type]
    finally:
        reset_workspace_event_sink(token)

    persisted_response = session_service.events[0].content.parts[0].function_response
    assert persisted_response.response == {"status": "ok"}
    streamed_response = streamed[0].content.parts[0].function_response
    assert streamed_response.response == {"status": "ok"}


async def _append(events: list[Event], event: Event) -> None:
    events.append(event)
