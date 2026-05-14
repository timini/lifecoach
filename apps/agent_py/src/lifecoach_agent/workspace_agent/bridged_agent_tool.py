"""AgentTool variant that surfaces workspace sub-agent tool calls.

ADK's stock AgentTool consumes the wrapped agent's event stream inside
``run_async`` and returns only the final text to the parent agent.  That
keeps the live chat stream (and the persisted parent session) blind to
the sub-agent's internal calls such as ``list_inbox`` and ``get_message``.

``BridgedAgentTool`` mirrors ADK's implementation but, while it consumes
inner events, it also copies any inner functionCall/functionResponse parts
onto the parent session and into a per-request live event sink installed by
``server.py``.  The parent still sees the normal AgentTool response, so
model behaviour and telemetry stay unchanged; only UI-visible events are
added.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from contextvars import ContextVar
from typing import Any

from google.adk.events import Event
from google.adk.tools.agent_tool import (  # type: ignore[attr-defined]
    AgentTool,
    _get_input_schema,
    _get_output_schema,
    validate_schema,
)
from google.adk.tools.tool_context import ToolContext
from google.adk.utils.context_utils import Aclosing
from google.genai import types

WorkspaceEventSink = Callable[[Event], Awaitable[None]]
_workspace_event_sink: ContextVar[WorkspaceEventSink | None] = ContextVar(
    "workspace_event_sink", default=None
)


def set_workspace_event_sink(sink: WorkspaceEventSink | None) -> Any:
    """Install a live event sink for the current request context.

    Returns the ContextVar token so callers can reset it in ``finally``.
    """

    return _workspace_event_sink.set(sink)


def reset_workspace_event_sink(token: Any) -> None:
    _workspace_event_sink.reset(token)


class BridgedAgentTool(AgentTool):
    """An ``AgentTool`` that mirrors inner tool events to the parent chat.

    The implementation intentionally tracks ADK 1.32.0's ``AgentTool``
    closely.  The only behavioural addition is ``_bridge_inner_event`` inside
    the inner runner loop.
    """

    async def run_async(self, *, args: dict[str, Any], tool_context: ToolContext) -> Any:
        from google.adk.runners import Runner
        from google.adk.sessions.in_memory_session_service import InMemorySessionService
        from google.adk.tools.agent_tool import (  # type: ignore[attr-defined]
            ForwardingArtifactService,
            InMemoryMemoryService,
        )

        if self.skip_summarization:
            tool_context.actions.skip_summarization = True

        input_schema = _get_input_schema(self.agent)
        if input_schema:
            input_value = input_schema.model_validate(args)
            content = types.Content(
                role="user",
                parts=[types.Part.from_text(text=input_value.model_dump_json(exclude_none=True))],
            )
        else:
            content = types.Content(role="user", parts=[types.Part.from_text(text=args["request"])])

        invocation_context = tool_context._invocation_context
        parent_app_name = invocation_context.app_name if invocation_context else None
        child_app_name = parent_app_name or self.agent.name
        plugins = invocation_context.plugin_manager.plugins if self.include_plugins else None
        runner: Any = Runner(
            app_name=child_app_name,
            agent=self.agent,
            artifact_service=ForwardingArtifactService(tool_context),
            session_service=InMemorySessionService(),  # type: ignore[no-untyped-call]
            memory_service=InMemoryMemoryService(),  # type: ignore[no-untyped-call]
            credential_service=invocation_context.credential_service,
            plugins=plugins,
        )

        state_dict = {
            k: v for k, v in tool_context.state.to_dict().items() if not k.startswith("_adk")
        }
        session = await runner.session_service.create_session(
            app_name=child_app_name,
            user_id=invocation_context.user_id,
            state=state_dict,
        )

        last_content = None
        last_grounding_metadata = None
        try:
            async with Aclosing(
                runner.run_async(
                    user_id=session.user_id, session_id=session.id, new_message=content
                )
            ) as agen:
                async for event in agen:
                    if event.actions.state_delta:
                        tool_context.state.update(event.actions.state_delta)
                    await _bridge_inner_event(event, tool_context=tool_context)
                    if event.content:
                        last_content = event.content
                        last_grounding_metadata = event.grounding_metadata
        finally:
            await runner.close()

        if last_content is None or last_content.parts is None:
            return ""
        merged_text = "\n".join(p.text for p in last_content.parts if p.text and not p.thought)
        output_schema = _get_output_schema(self.agent)
        tool_result = validate_schema(output_schema, merged_text) if output_schema else merged_text

        if self.propagate_grounding_metadata and last_grounding_metadata:
            tool_context.state["temp:_adk_grounding_metadata"] = last_grounding_metadata

        return tool_result


async def _bridge_inner_event(event: Event, *, tool_context: ToolContext) -> None:
    """Copy inner function-call/response parts into the parent event stream."""

    if not event.content or not event.content.parts:
        return

    bridged_parts: list[types.Part] = []
    parent_call_id = tool_context.function_call_id or tool_context._invocation_context.agent.name
    for part in event.content.parts:
        function_call = getattr(part, "function_call", None)
        if function_call is not None and function_call.name:
            bridged = types.Part.from_function_call(
                name=function_call.name,
                args=dict(function_call.args or {}),
            )
            assert bridged.function_call is not None
            bridged.function_call.id = _bridged_id(
                parent_call_id, function_call.id, function_call.name
            )
            bridged_parts.append(bridged)
            continue

        function_response = getattr(part, "function_response", None)
        if function_response is not None and function_response.name:
            bridged = types.Part.from_function_response(
                name=function_response.name,
                response=dict(function_response.response or {}),
            )
            assert bridged.function_response is not None
            bridged.function_response.id = _bridged_id(
                parent_call_id, function_response.id, function_response.name
            )
            bridged_parts.append(bridged)

    if not bridged_parts:
        return

    parent_invocation = tool_context._invocation_context
    persist_event = Event(
        invocation_id=parent_invocation.invocation_id,
        author=parent_invocation.agent.name,
        content=types.Content(role=event.content.role, parts=bridged_parts),
        branch=parent_invocation.branch,
    )
    # Persist on the parent session so /history rehydration sees the same
    # inner tool badges after reload.  FirestoreSessionService deliberately
    # skips partial events, so this copy remains non-partial.
    await parent_invocation.session_service.append_event(
        session=parent_invocation.session,
        event=persist_event,
    )

    sink = _workspace_event_sink.get()
    if sink is None:
        return

    live_event = persist_event.model_copy(deep=True)
    if any(getattr(part, "function_call", None) for part in bridged_parts):
        # The web SSE parser intentionally renders functionCall badges only
        # from partial events to avoid ADK's final aggregate duplicates.
        live_event.partial = True
    await sink(live_event)


def _bridged_id(parent_call_id: str, inner_id: str | None, inner_name: str) -> str:
    return f"{parent_call_id}:{inner_id or inner_name}"
