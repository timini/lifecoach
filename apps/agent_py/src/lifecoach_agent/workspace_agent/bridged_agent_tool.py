"""AgentTool variant that mirrors workspace sub-agent tool calls to chat.

ADK's stock :class:`AgentTool` consumes the wrapped agent's event stream
inside ``run_async`` and returns only the final text to the parent agent.
For the workspace sub-agents that means the user sees one outer
``triage_inbox``/``find_workspace`` badge while the useful inner Gmail /
Calendar / Tasks tool calls are invisible.

``BridgedAgentTool`` keeps the normal AgentTool result semantics, but when
an inner event contains a functionCall or functionResponse it emits a
synthetic parent-authored event to the request's SSE queue and appends the
same non-partial event to the parent session. The web client keys on the
``__parentToolCallId`` metadata to render those calls under the outer badge.
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

WORKSPACE_PARENT_TOOL_CALL_ID_KEY = "__parentToolCallId"
WORKSPACE_INNER_TOOL_KEY = "__workspaceInner"


class BridgedAgentTool(AgentTool):
    """AgentTool that forwards wrapped-agent tool events to the parent chat."""

    def __init__(
        self,
        *,
        agent: Any,
        event_queue: asyncio.Queue[bytes | None] | None = None,
        skip_summarization: bool = False,
    ) -> None:
        super().__init__(agent=agent, skip_summarization=skip_summarization)
        # AgentTool/BaseTool are pydantic models; object.__setattr__ keeps this
        # runtime-only request queue out of tool declaration serialisation.
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
        runner = Runner(
            app_name=child_app_name,
            agent=self.agent,
            artifact_service=ForwardingArtifactService(tool_context),
            session_service=InMemorySessionService(),
            memory_service=InMemoryMemoryService(),
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
        for part in event.content.parts:
            function_call = getattr(part, "function_call", None) or getattr(
                part, "functionCall", None
            )
            function_response = getattr(part, "function_response", None) or getattr(
                part, "functionResponse", None
            )
            if function_call is not None:
                args = dict(getattr(function_call, "args", None) or {})
                args[WORKSPACE_PARENT_TOOL_CALL_ID_KEY] = parent_id
                args[WORKSPACE_INNER_TOOL_KEY] = True
                bridged_parts.append(
                    types.Part(
                        function_call=types.FunctionCall(
                            id=getattr(function_call, "id", None),
                            name=getattr(function_call, "name", None),
                            args=args,
                        )
                    )
                )
            if function_response is not None:
                response = getattr(function_response, "response", None)
                response = dict(response) if isinstance(response, dict) else {"result": response}
                response[WORKSPACE_PARENT_TOOL_CALL_ID_KEY] = parent_id
                response[WORKSPACE_INNER_TOOL_KEY] = True
                bridged_parts.append(
                    types.Part(
                        function_response=types.FunctionResponse(
                            id=getattr(function_response, "id", None),
                            name=getattr(function_response, "name", None),
                            response=response,
                        )
                    )
                )

        if not bridged_parts:
            return

        # ADK / Gemini represent tool output (functionResponse parts) as
        # role="user" and tool invocations (functionCall parts) as
        # role="model". Forcing role="model" on bridged response events
        # makes a later reload of /history surface functionResponse parts
        # inside a model-authored content block, which Gemini treats as
        # invalid. Pick the role from the bridged_parts shape instead of
        # hardcoding it.
        has_response = any(
            getattr(p, "function_response", None) is not None
            or getattr(p, "functionResponse", None) is not None
            for p in bridged_parts
        )
        bridged_role = "user" if has_response else "model"

        base = {
            "author": "lifecoach",
            "content": types.Content(role=bridged_role, parts=bridged_parts),
            "custom_metadata": {
                WORKSPACE_PARENT_TOOL_CALL_ID_KEY: parent_id,
                WORKSPACE_INNER_TOOL_KEY: True,
                "workspaceAgent": self.agent.name,
            },
            "id": f"workspace-inner-{secrets.token_hex(6)}",
            "timestamp": time.time(),
        }
        live_event = Event(partial=True, **base)
        stored_event = Event(**base)

        queue = getattr(self, "_event_queue", None)
        if queue is not None:
            payload = live_event.model_dump(mode="json", by_alias=True, exclude_none=True)
            await queue.put(f"data: {json.dumps(payload, default=str)}\n\n".encode())

        parent_session = tool_context._invocation_context.session
        parent_session_service = tool_context._invocation_context.session_service
        append_event = getattr(parent_session_service, "append_event", None)
        if callable(append_event):
            await append_event(session=parent_session, event=stored_event)
