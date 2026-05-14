"""AgentTool variant that mirrors workspace sub-agent tool calls.

ADK's stock AgentTool consumes the wrapped agent's event stream and returns
only its final text to the parent agent. For the chat UI that means the user
sees a single high-level ``triage_inbox`` / ``find_workspace`` badge while the
sub-agent's real Workspace reads are hidden. ``BridgedAgentTool`` keeps the
same public Tool contract but forwards function-call / function-response events
from the wrapped agent as synthetic parent-authored events tagged with the
parent tool-call id.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from contextvars import ContextVar
from typing import Any

from google.adk.events import Event
from google.adk.memory.in_memory_memory_service import InMemoryMemoryService
from google.adk.runners import Runner
from google.adk.sessions.in_memory_session_service import InMemorySessionService
from google.adk.tools._forwarding_artifact_service import ForwardingArtifactService
from google.adk.tools.agent_tool import AgentTool, _get_input_schema, _get_output_schema
from google.adk.tools.tool_context import ToolContext
from google.adk.utils._schema_utils import validate_schema
from google.adk.utils.context_utils import Aclosing
from google.genai import types

BridgeEventSink = Callable[[Event], Awaitable[None]]

_bridge_event_sink: ContextVar[BridgeEventSink | None] = ContextVar(
    "lifecoach_bridge_event_sink", default=None
)


def set_bridge_event_sink(sink: BridgeEventSink | None) -> Any:
    """Install a per-request sink for synthetic bridged events.

    Returns the ContextVar token so callers can reset it in a ``finally`` block.
    """

    return _bridge_event_sink.set(sink)


def reset_bridge_event_sink(token: Any) -> None:
    _bridge_event_sink.reset(token)


class BridgedAgentTool(AgentTool):
    """An ``AgentTool`` that bubbles nested function events to the parent chat.

    The final return value, state-delta forwarding, plugin propagation, and
    grounding-metadata behavior intentionally match ADK 1.32.0's AgentTool.
    Only functionCall/functionResponse events are bridged; sub-agent text stays
    private so the parent agent remains responsible for user-facing copy.
    """

    async def run_async(self, *, args: dict[str, Any], tool_context: ToolContext) -> Any:
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
        plugins = (
            tool_context._invocation_context.plugin_manager.plugins
            if self.include_plugins
            else None
        )
        runner = Runner(
            app_name=child_app_name,
            agent=self.agent,
            artifact_service=ForwardingArtifactService(tool_context),
            session_service=InMemorySessionService(),
            memory_service=InMemoryMemoryService(),
            credential_service=tool_context._invocation_context.credential_service,
            plugins=plugins,
        )

        state_dict = {
            k: v for k, v in tool_context.state.to_dict().items() if not k.startswith("_adk")
        }
        session = await runner.session_service.create_session(
            app_name=child_app_name,
            user_id=tool_context._invocation_context.user_id,
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
                    if _has_function_part(event):
                        await _bridge_event(event, tool_context)
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


async def _bridge_event(event: Event, tool_context: ToolContext) -> None:
    parent_tool_call_id = tool_context.function_call_id
    if not parent_tool_call_id or event.content is None:
        return

    bridged = Event(
        author="lifecoach",
        content=event.content,
        partial=False,
        custom_metadata={
            "parentToolCallId": parent_tool_call_id,
            "workspaceAgentTool": tool_context._invocation_context.agent.name,
        },
    )

    # Live UI sink only — do NOT append to the parent session here.
    #
    # The parent agent's own `triage_inbox` / `find_workspace` function_call
    # event is still streaming as `partial=true` at this point, so the parent
    # runner has not yet committed it to the session. Appending bridged child
    # events from inside the child tool would write them BEFORE the parent
    # call lands, which then shows the nested badges out-of-order in /history
    # replays (children before parent). Streaming to the live sink is fine
    # because the live UI received the parent's partial events first — the
    # in-memory order already matches what the user saw. /history replays
    # collapse to the stock AgentTool behaviour: the parent badge surfaces,
    # the nested children do not. Same trade-off ADK ships with.
    sink = _bridge_event_sink.get()
    if sink is not None:
        await sink(bridged)


def _has_function_part(event: Event) -> bool:
    parts = event.content.parts if event.content and event.content.parts else []
    for part in parts:
        if part.function_call is not None or part.function_response is not None:
            return True
    return False
