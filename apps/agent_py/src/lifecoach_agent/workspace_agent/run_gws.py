"""One-call helper that wraps the auth + dispatch + classify + log flow
used by every workspace tool (sub-agent reads, main-facing writes).

Behaviour parallels `apps/agent/src/agents/workspaceAgent/runGws.ts`:

- On `scope_required`, deletes the user's token doc so the next turn
  drops back to `google_linked` and the LLM invites reconnect.
- Returns the parsed body on success.
- Tokens are never present in `params`, `body`, or any log emission.
"""

from __future__ import annotations

import contextlib
import json
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Literal

from lifecoach_agent.storage.workspace_tokens import (
    ScopeRequiredError,
    WorkspaceTokensStore,
)
from lifecoach_agent.workspace_agent.gws_client import (
    CallWorkspaceErr,
    CallWorkspaceErrorCode,
    CallWorkspaceOk,
    call_workspace,
)

# Auth-class errors mean the token is stale or scoped wrong — drop the
# doc so the state machine demotes to `google_linked` on the next turn.
_AUTH_ERROR_CODES: frozenset[str] = frozenset({"scope_required"})


@dataclass(frozen=True)
class RunGwsLogEvent:
    name: str
    service: str
    resource: str
    method: str
    outcome: str  # 'ok' or one of the GwsErrorCode literals
    stdout_bytes: int = 0


@dataclass(frozen=True)
class RunGwsOk:
    status: Literal["ok"] = "ok"
    body: Any = None
    truncated: bool = False


@dataclass(frozen=True)
class RunGwsErr:
    status: Literal["error"]
    code: CallWorkspaceErrorCode
    message: str


RunGwsResult = RunGwsOk | RunGwsErr

LogEmitter = Callable[[RunGwsLogEvent], None]


async def run_gws(
    *,
    store: WorkspaceTokensStore,
    uid: str,
    tool_name: str,
    service: str,
    resource: str,
    method: str,
    params: dict[str, Any] | None = None,
    body: Any = None,
    build_client: Any | None = None,
    log: LogEmitter | None = None,
) -> RunGwsResult:
    """Resolve token + dispatch + classify + log. Use this from every
    workspace tool implementation; never call `call_workspace()` directly.
    """
    params_obj: dict[str, Any] = dict(params or {})
    if body is not None:
        params_obj["requestBody"] = body

    try:
        access_token = await store.get_valid_access_token(uid)
    except ScopeRequiredError:
        if log is not None:
            log(
                RunGwsLogEvent(
                    name=tool_name,
                    service=service,
                    resource=resource,
                    method=method,
                    outcome="scope_required",
                )
            )
        return RunGwsErr(
            status="error",
            code="scope_required",
            message="Workspace access expired. Ask the user to reconnect in Settings.",
        )

    encoded_params = json.dumps(params_obj) if params_obj else None
    result = await call_workspace(
        access_token=access_token,
        service=service,
        resource=resource,
        method=method,
        params=encoded_params,
        build_client=build_client,
    )

    if isinstance(result, CallWorkspaceOk):
        if log is not None:
            log(
                RunGwsLogEvent(
                    name=tool_name,
                    service=service,
                    resource=resource,
                    method=method,
                    outcome="ok",
                )
            )
        return RunGwsOk(status="ok", body=result.body, truncated=result.truncated)

    err: CallWorkspaceErr = result
    if err.code in _AUTH_ERROR_CODES:
        with contextlib.suppress(Exception):
            await store.delete(uid)
    if log is not None:
        log(
            RunGwsLogEvent(
                name=tool_name,
                service=service,
                resource=resource,
                method=method,
                outcome=err.code,
            )
        )
    return RunGwsErr(status="error", code=err.code, message=err.message)
