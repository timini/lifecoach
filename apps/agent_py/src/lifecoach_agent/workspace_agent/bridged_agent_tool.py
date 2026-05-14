"""AgentTool variant that surfaces workspace sub-agent tool calls.

ADK's stock :class:`AgentTool` consumes the wrapped agent's event stream
inside ``run_async`` and returns only the final text to the parent agent.
For workspace sub-agents that means the user sees one outer
``triage_inbox`` / ``find_workspace`` badge while the useful inner Gmail /
Calendar / Tasks tool calls are invisible.

``BridgedAgentTool`` keeps the normal ``AgentTool`` result semantics, but
while consuming inner events it also forwards any ``functionCall`` /
``functionResponse`` parts to:

  1. A per-request ``asyncio.Queue[bytes | None]`` that ``server.py``
     drains as SSE — the live UI gets a nested badge for each inner
     call as it happens.
  2. The parent session, tagged for history rehydration but
     deliberately authored as a *different* agent so ADK's
     :mod:`google.adk.flows.llm_flows.contents` treats them as foreign
     replies (converted to user-context text) instead of replaying them
     as if the main agent had called those tools itself on the next turn.

That last point closes a real footgun: the main agent only registers
``triage_inbox`` / ``find_workspace`` plus the writes; the inner Gmail
reads (``list_inbox`` / ``get_message`` / ...) are NOT in its tool
surface. If the bridged events were authored as ``"lifecoach"`` they
would be loaded by ADK on subsequent turns as if the main agent had
called those tools, and Gemini would either reject the history or hunt
for tools the main agent does not have.

Inner ``functionResponse`` payloads are also redacted before persistence
(see :func:`_redact_inner_response`): ``get_message`` returns up to ~4
KB of decoded email body that we do not want copied into the parent
chat session. The badge only needs status/error; the body is private to
the sub-agent's reasoning loop.
"""

from __future__ import annotations

import asyncio
import json
import secrets
import time
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

# Custom-metadata + arg keys the FE uses to group bridged child events
# under their outer AgentTool parent. Kept in sync with the
# `WORKSPACE_PARENT_TOOL_CALL_ID_KEY` constant in `apps/web/src/lib/sse.ts`.
WORKSPACE_PARENT_TOOL_CALL_ID_KEY = "__parentToolCallId"
WORKSPACE_INNER_TOOL_KEY = "__workspaceInner"

# Author tag for bridged events when persisted to the parent session.
# Crucial: this is NOT "lifecoach" so ADK's contents builder
# (`_is_other_agent_reply`) treats them as foreign replies, converts
# them to user-context text on the next turn, and does NOT replay them
# as main-agent function calls. The FE recognises this author and
# renders the bridged badges under their parent.
WORKSPACE_BRIDGE_AUTHOR = "lifecoach-workspace-bridge"

# Inner workspace tools (e.g. `get_message`) return up to ~4 KB of
# decoded email body + allow-listed headers under the `message` key.
# That payload is meaningful to the sub-agent's reasoning but is
# private user data we do not want to ship over SSE or persist as a
# tool-badge `response` on the parent chat. The badge only needs the
# success/failure scalars, so we redact everything else.
_SAFE_RESPONSE_KEYS = frozenset({"status", "code", "error", "count"})


def _redact_inner_response(response: Any) -> dict[str, Any]:
    if not isinstance(response, dict):
        return {}
    return {k: v for k, v in response.items() if k in _SAFE_RESPONSE_KEYS}


class BridgedAgentTool(AgentTool):
    """An ``AgentTool`` that bubbles nested function events to the parent chat.

    The final return value, state-delta forwarding, plugin propagation,
    and grounding-metadata behaviour intentionally match
    :class:`google.adk.tools.agent_tool.AgentTool` (ADK 1.32). Only
    function-call / function-response events from the wrapped agent are
    bridged; sub-agent text stays private so the parent agent remains
    responsible for user-facing copy.
    """

    def __init__(
        self,
        *,
        agent: Any,
        event_queue: asyncio.Queue[bytes | None] | None = None,
        skip_summarization: bool = False,
    ) -> None:
        super().__init__(agent=agent, skip_summarization=skip_summarization)
        # ``AgentTool`` / ``BaseTool`` are pydantic models — use
        # object.__setattr__ to attach the per-request queue without it
        # being serialised into the tool declaration sent to Gemini.
        object.__setattr__(self, "_event_queue", event_queue)

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
            content = types.Content(
                role="user",
                parts=[types.Part.from_text(text=args["request"])],
            )

        invocation_context = tool_context._invocation_context
        child_app_name = invocation_context.app_name if invocation_context else self.agent.name
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
                    await self._bridge_inner_tool_event(event, tool_context)
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

    async def _bridge_inner_tool_event(self, event: Event, tool_context: ToolContext) -> None:
        parent_id = tool_context.function_call_id
        if not parent_id or event.content is None or event.content.parts is None:
            return

        bridged_parts: list[types.Part] = []
        has_response = False
        has_call = False
        for part in event.content.parts:
            function_call = getattr(part, "function_call", None)
            function_response = getattr(part, "function_response", None)
            if function_call is not None and function_call.name:
                has_call = True
                args = dict(getattr(function_call, "args", None) or {})
                args[WORKSPACE_PARENT_TOOL_CALL_ID_KEY] = parent_id
                args[WORKSPACE_INNER_TOOL_KEY] = True
                bridged_parts.append(
                    types.Part(
                        function_call=types.FunctionCall(
                            id=_bridged_id(parent_id, function_call.id, function_call.name),
                            name=function_call.name,
                            args=args,
                        )
                    )
                )
            if function_response is not None and function_response.name:
                has_response = True
                # Persist + stream only the redacted scalars. The live UI
                # already received the parent's partial events first; the
                # sub-agent uses the full response internally, but the
                # main session must not retain decoded email bodies.
                response = _redact_inner_response(function_response.response)
                response[WORKSPACE_PARENT_TOOL_CALL_ID_KEY] = parent_id
                response[WORKSPACE_INNER_TOOL_KEY] = True
                bridged_parts.append(
                    types.Part(
                        function_response=types.FunctionResponse(
                            id=_bridged_id(parent_id, function_response.id, function_response.name),
                            name=function_response.name,
                            response=response,
                        )
                    )
                )

        if not bridged_parts:
            return

        # ADK / Gemini convention:
        #   - functionCall parts live in role="model"
        #   - functionResponse parts live in role="user"
        # Hardcoding role="model" (PR #102 P1) makes a later /history
        # reload surface a model-authored content block that contains
        # functionResponse parts — Gemini rejects that as invalid. Pick
        # the role from the part shape, matching the original child
        # event's role conventions.
        bridged_role = "user" if has_response and not has_call else "model"

        custom_metadata: dict[str, Any] = {
            "parentToolCallId": parent_id,
            WORKSPACE_INNER_TOOL_KEY: True,
            "workspaceAgent": getattr(self.agent, "name", None) or "workspace",
        }
        content = types.Content(role=bridged_role, parts=bridged_parts)
        event_id = f"workspace-inner-{secrets.token_hex(6)}"
        event_ts = time.time()
        # Authoring as the workspace bridge keeps these out of the main
        # agent's tool-call history on the next turn — see module
        # docstring + PR #101 P2 ("Keep bridged sub-agent calls out of
        # main-agent history").
        #
        # Streaming copy: tagged partial=true so the FE's SSE reducer
        # treats it the same as any other in-flight tool-call delta.
        live_event = Event(
            author=WORKSPACE_BRIDGE_AUTHOR,
            content=content,
            custom_metadata=custom_metadata,
            id=event_id,
            timestamp=event_ts,
            partial=True,
        )
        # Persisted copy: non-partial so history rehydration sees it.
        stored_event = Event(
            author=WORKSPACE_BRIDGE_AUTHOR,
            content=content,
            custom_metadata=custom_metadata,
            id=event_id,
            timestamp=event_ts,
        )

        queue = getattr(self, "_event_queue", None)
        if queue is not None:
            payload = live_event.model_dump(mode="json", by_alias=True, exclude_none=True)
            await queue.put(f"data: {json.dumps(payload, default=str)}\n\n".encode())

        parent_session = tool_context._invocation_context.session
        parent_session_service = tool_context._invocation_context.session_service
        append_event = getattr(parent_session_service, "append_event", None)
        if callable(append_event):
            await append_event(session=parent_session, event=stored_event)


def _bridged_id(parent_call_id: str, inner_id: str | None, inner_name: str) -> str:
    return f"{parent_call_id}:{inner_id or inner_name}"
