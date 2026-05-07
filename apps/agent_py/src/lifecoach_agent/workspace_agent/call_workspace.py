"""call_workspace ADK tool — wraps `gws_client.call_workspace` with the
LLM-facing parameter shape and the per-uid token lookup.

Mirrors the public surface of `apps/agent/src/tools/callWorkspace.ts`,
minus the gws CLI plumbing.
"""

from __future__ import annotations

from dataclasses import asdict
from typing import Any

from lifecoach_agent.storage.workspace_tokens import (
    ScopeRequiredError,
    WorkspaceTokensStore,
)
from lifecoach_agent.workspace_agent.gws_client import (
    CallWorkspaceOk,
    call_workspace,
)

CALL_WORKSPACE_TOOL_NAME = "call_workspace"


def create_call_workspace_tool(
    *, store: WorkspaceTokensStore, uid: str, build_client: Any | None = None
) -> Any:
    """Build the `call_workspace` ADK FunctionTool. Closes over the
    user's uid + token store so the LLM never sees auth values."""

    async def call_workspace_tool(
        service: str, resource: str, method: str, params: str | None = None
    ) -> dict[str, Any]:
        """Perform a Google Workspace operation across Gmail, Calendar,
        and Tasks. Use Discovery-spec parameters as a JSON-encoded string.
        The application handles authentication automatically — do not
        attempt to pass tokens or secrets.

        Args:
            service: One of "gmail", "calendar", "tasks".
            resource: Discovery resource path. For Gmail this is the
                dotted form ("users.messages", "users.threads",
                "users.labels"). For Calendar/Tasks the simple form
                ("events", "tasks", "tasklists") works.
            method: Method on the resource — "list", "get", "send",
                "modify", "trash", "insert", "patch", "delete".
            params: JSON-encoded parameters per the Google Discovery
                spec. Body fields nest under a "requestBody" key; path
                and query fields stay top-level. Omit for methods that
                take no params.
        """
        try:
            access_token = await store.get_valid_access_token(uid)
        except ScopeRequiredError as err:
            return {"status": "error", "code": "scope_required", "message": str(err)}

        result = await call_workspace(
            access_token=access_token,
            service=service,
            resource=resource,
            method=method,
            params=params,
            build_client=build_client,
        )
        if isinstance(result, CallWorkspaceOk):
            out: dict[str, Any] = {"status": "ok", "body": result.body}
            if result.truncated:
                out["truncated"] = True
            return out
        # CallWorkspaceErr — flatten the dataclass for the LLM.
        err_dict = asdict(result)
        return err_dict

    from google.adk.tools import FunctionTool

    # Rename the underlying function so ADK picks up the canonical tool name.
    call_workspace_tool.__name__ = CALL_WORKSPACE_TOOL_NAME
    return FunctionTool(call_workspace_tool)
