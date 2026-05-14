"""Unit tests for `BridgedAgentTool`.

Focuses on the bridging behaviour — the AgentTool result semantics are
covered by upstream ADK tests, so these only exercise the synthetic
parent-authored events the bridge appends to the parent session + live
SSE queue.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import Any

import pytest
from google.adk.events import Event
from google.genai import types

from lifecoach_agent.workspace_agent.agent_tools import (
    create_find_workspace_tool,
    create_triage_inbox_tool,
)
from lifecoach_agent.workspace_agent.bridged_agent_tool import (
    WORKSPACE_BRIDGE_AUTHOR,
    BridgedAgentTool,
)
from lifecoach_agent.workspace_agent.tools._deps import WorkspaceToolDeps


class _SessionService:
    def __init__(self) -> None:
        self.events: list[Event] = []

    async def append_event(self, *, session: Any, event: Event) -> Event:
        self.events.append(event)
        return event


def _make_bridged_tool(
    *, event_queue: asyncio.Queue[bytes | None] | None = None
) -> BridgedAgentTool:
    agent = SimpleNamespace(name="triage_inbox", description="triage gmail")
    return BridgedAgentTool(agent=agent, event_queue=event_queue)  # type: ignore[arg-type]


def _tool_context(session_service: _SessionService) -> Any:
    invocation = SimpleNamespace(
        invocation_id="parent-invocation",
        agent=SimpleNamespace(name="lifecoach"),
        branch=None,
        session_service=session_service,
        session=SimpleNamespace(),
    )
    return SimpleNamespace(
        function_call_id="parent-call",
        _invocation_context=invocation,
    )


# --- Factory wiring ------------------------------------------------------


class _FakeStore:
    pass


def test_workspace_agent_tools_use_bridged_agent_tool() -> None:
    deps = WorkspaceToolDeps(store=_FakeStore(), uid="u1")  # type: ignore[arg-type]

    assert isinstance(create_triage_inbox_tool(deps), BridgedAgentTool)
    assert isinstance(create_find_workspace_tool(deps), BridgedAgentTool)


def test_workspace_agent_tools_carry_event_queue_when_provided() -> None:
    deps = WorkspaceToolDeps(store=_FakeStore(), uid="u1")  # type: ignore[arg-type]
    queue: asyncio.Queue[bytes | None] = asyncio.Queue()

    triage = create_triage_inbox_tool(deps, event_queue=queue)
    find = create_find_workspace_tool(deps, event_queue=queue)

    assert triage._event_queue is queue
    assert find._event_queue is queue


# --- Role + author preservation -----------------------------------------


@pytest.mark.asyncio
async def test_bridged_function_response_uses_user_role() -> None:
    """ADK/Gemini convention: function_response parts live in role='user'
    content. Bridging them under role='model' (PR #102 P1) makes a later
    /history reload surface a model message containing functionResponse
    parts, which Gemini rejects as invalid."""

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


@pytest.mark.asyncio
async def test_bridged_events_use_workspace_bridge_author_not_lifecoach() -> None:
    """Persisted bridged events must NOT be authored as the main agent
    (``lifecoach``). The main agent only registers
    ``triage_inbox`` / ``find_workspace`` plus the writes — if bridged
    children were authored as ``lifecoach``, ADK's contents builder
    would replay them as the main agent's own tool calls on the next
    turn (PR #101 P2)."""

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

    stored = session_service.events[0]
    assert stored.author == WORKSPACE_BRIDGE_AUTHOR
    assert stored.author != "lifecoach"


# --- Parent linkage ------------------------------------------------------


@pytest.mark.asyncio
async def test_bridged_event_carries_parent_tool_call_id_in_metadata_and_args() -> None:
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

    stored = session_service.events[0]
    assert stored.custom_metadata["parentToolCallId"] == "parent-call"
    fc = stored.content.parts[0].function_call
    assert fc.args["__parentToolCallId"] == "parent-call"
    assert fc.args["__workspaceInner"] is True


# --- Redaction -----------------------------------------------------------


@pytest.mark.asyncio
async def test_bridge_redacts_bulky_inner_response_payload() -> None:
    """Inner workspace tools may return decoded email bodies (up to 4
    KB). Bridging the raw payload would leak that content over SSE and
    persist it as the parent tool-badge response. Only the
    success/error scalars survive the bridge (PR #100 P2)."""

    session_service = _SessionService()
    tool = _make_bridged_tool()
    inner = Event(
        invocation_id="inner",
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

    await tool._bridge_inner_tool_event(inner, _tool_context(session_service))

    stored_response = session_service.events[0].content.parts[0].function_response
    assert "message" not in stored_response.response
    assert "body" not in stored_response.response
    assert stored_response.response["status"] == "ok"


# --- Live SSE sink -------------------------------------------------------


@pytest.mark.asyncio
async def test_bridged_event_streams_to_event_queue_when_provided() -> None:
    session_service = _SessionService()
    queue: asyncio.Queue[bytes | None] = asyncio.Queue()
    tool = _make_bridged_tool(event_queue=queue)
    inner = Event(
        invocation_id="inner",
        author="triage_inbox",
        content=types.Content(
            role="model",
            parts=[types.Part.from_function_call(name="list_inbox", args={"since": "1d"})],
        ),
    )

    await tool._bridge_inner_tool_event(inner, _tool_context(session_service))

    chunk = await asyncio.wait_for(queue.get(), timeout=0.1)
    assert chunk is not None
    decoded = chunk.decode("utf-8")
    assert decoded.startswith("data: ")
    # Streaming copy must be tagged partial=true so the FE's SSE reducer
    # renders the badge — the FE deliberately filters trailing
    # `partial=false` aggregates to avoid duplicates.
    assert '"partial": true' in decoded
    # And it must carry the parent linkage so the FE nests the badge.
    assert "parent-call" in decoded


@pytest.mark.asyncio
async def test_bridge_is_a_noop_when_no_parent_call_id() -> None:
    """Bridging requires a parent function_call_id — without it there is
    no badge to nest under, so we skip the append entirely."""

    session_service = _SessionService()
    tool = _make_bridged_tool()
    inner = Event(
        invocation_id="inner",
        author="triage_inbox",
        content=types.Content(
            role="model",
            parts=[types.Part.from_function_call(name="list_inbox", args={})],
        ),
    )
    tool_context = _tool_context(session_service)
    tool_context.function_call_id = None

    await tool._bridge_inner_tool_event(inner, tool_context)

    assert session_service.events == []
