"""One-call helper that wraps the auth + dispatch + classify + log
flow used by every Notion tool. Parallels `workspace_agent.run_gws`.

On `scope_required`, deletes the user's token doc so the state-flag
on next turn collapses to `notion_connected=False` and the LLM
invites a reconnect via `connect_notion`. Tokens are never present
in `body` or any log emission.
"""

from __future__ import annotations

import contextlib
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Literal

import httpx

from lifecoach_agent.notion_agent.notion_client import (
    CallNotionErr,
    CallNotionErrorCode,
    CallNotionOk,
    call_notion,
)
from lifecoach_agent.storage.notion_tokens import (
    NotionScopeRequiredError,
    NotionTokensStore,
)

# Auth-class errors mean the token is stale, the integration was
# removed at notion.so/my-integrations, or the user revoked at our end.
# Drop the doc so the capability flag collapses on the next request.
_AUTH_ERROR_CODES: frozenset[str] = frozenset({"scope_required"})


@dataclass(frozen=True)
class RunNotionLogEvent:
    name: str
    method: str
    path: str
    outcome: str  # 'ok' or one of CallNotionErrorCode values


@dataclass(frozen=True)
class RunNotionOk:
    status: Literal["ok"] = "ok"
    body: Any = None
    truncated: bool = False


@dataclass(frozen=True)
class RunNotionErr:
    status: Literal["error"]
    code: CallNotionErrorCode
    message: str


RunNotionResult = RunNotionOk | RunNotionErr

LogEmitter = Callable[[RunNotionLogEvent], None]


async def run_notion(
    *,
    store: NotionTokensStore,
    uid: str,
    tool_name: str,
    method: Literal["GET", "POST", "PATCH", "DELETE"],
    path: str,
    body: Any = None,
    http: httpx.AsyncClient | None = None,
    log: LogEmitter | None = None,
) -> RunNotionResult:
    """Resolve token + dispatch + classify + log. Every Notion tool
    routes through this; no tool calls `call_notion()` directly."""
    try:
        access_token = await store.get_valid_access_token(uid)
    except NotionScopeRequiredError:
        if log is not None:
            log(
                RunNotionLogEvent(
                    name=tool_name,
                    method=method,
                    path=path,
                    outcome="scope_required",
                )
            )
        return RunNotionErr(
            status="error",
            code="scope_required",
            message="Notion access expired. Ask the user to reconnect.",
        )

    result = await call_notion(
        access_token=access_token,
        method=method,
        path=path,
        body=body,
        http=http,
    )

    if isinstance(result, CallNotionOk):
        if log is not None:
            log(
                RunNotionLogEvent(
                    name=tool_name,
                    method=method,
                    path=path,
                    outcome="ok",
                )
            )
        return RunNotionOk(status="ok", body=result.body, truncated=result.truncated)

    err: CallNotionErr = result
    if err.code in _AUTH_ERROR_CODES:
        with contextlib.suppress(Exception):
            await store.delete(uid)
    if log is not None:
        log(
            RunNotionLogEvent(
                name=tool_name,
                method=method,
                path=path,
                outcome=err.code,
            )
        )
    return RunNotionErr(status="error", code=err.code, message=err.message)
