"""Google Workspace API dispatcher — replaces the TS-side `gws` CLI
subprocess with `google-api-python-client` direct calls.

The dispatcher takes a Discovery-API-style address — `(service,
resource, method, params)` — and walks the discovery-built service
object to invoke the right method. Errors are mapped to the
fine-grained `CallWorkspaceErrorCode` codes the system prompt's
WORKSPACE error-handling block reasons over.

This is a deliberate single-tool-dispatch layer matching the existing
TS `call_workspace` surface, so the prompt's WORKSPACE_CHEATSHEET keeps
working byte-for-byte. Phase 7's full sub-agent redesign (separate ADK
sub-agent with 9 narrow internal tools + 2 AgentTool wrappers) lands
as a follow-up — the design lives in
`~/.claude/plans/no-server-ip-fallback-encapsulated-sunset.md`.
"""

from __future__ import annotations

import asyncio
import json
import re
from dataclasses import dataclass
from typing import Any, Literal

WorkspaceService = Literal["gmail", "calendar", "tasks"]
WORKSPACE_SERVICES: tuple[WorkspaceService, ...] = ("gmail", "calendar", "tasks")

MAX_RESPONSE_BYTES = 32 * 1024
DEFAULT_TIMEOUT_S = 20.0

CallWorkspaceErrorCode = Literal[
    "scope_required",
    "forbidden",
    "network",
    "rate_limited",
    "not_found",
    "bad_request",
    "timeout",
    "upstream",
    "invalid_args",
]


@dataclass(frozen=True)
class CallWorkspaceOk:
    status: Literal["ok"] = "ok"
    body: Any = None
    truncated: bool = False


@dataclass(frozen=True)
class CallWorkspaceErr:
    status: Literal["error"]
    code: CallWorkspaceErrorCode
    message: str


CallWorkspaceResult = CallWorkspaceOk | CallWorkspaceErr


# Mapping for `service` → discovery API name + version. Hardcoded so a
# rogue input never reaches `googleapiclient.discovery.build`.
_API_VERSIONS: dict[str, tuple[str, str]] = {
    "gmail": ("gmail", "v1"),
    "calendar": ("calendar", "v3"),
    "tasks": ("tasks", "v1"),
}


def _walk_resource(client: Any, resource: str) -> Any:
    """Walk the dotted resource path on a discovery-built service.

    e.g. resource="users.messages" on a Gmail client → calls
    `client.users().messages()` and returns the resulting `Resource`."""
    obj = client
    for part in resource.split("."):
        if not part:
            raise ValueError(f"empty segment in resource path: {resource!r}")
        method = getattr(obj, part, None)
        if method is None or not callable(method):
            raise ValueError(f"unknown resource segment {part!r} in {resource!r}")
        obj = method()
    return obj


def _split_request_body(params: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any] | None]:
    """The wire convention is: body fields nest under `requestBody`,
    everything else is path/query. Splits accordingly so the discovery
    client can take `body=` separately from path params."""
    rest = dict(params)
    body = rest.pop("requestBody", None)
    if body is not None and not isinstance(body, dict):
        raise ValueError("requestBody must be an object when present")
    return rest, body


def _classify_http_error(status: int, message: str) -> CallWorkspaceErrorCode:
    lc = (message or "").lower()
    if status == 401 or "invalid_grant" in lc or "invalid credential" in lc:
        return "scope_required"
    if status == 403:
        if re.search(r"insufficient.*scope|scope|grant", lc):
            return "scope_required"
        return "forbidden"
    if status == 429 or "ratelimitexceeded" in lc or re.search(r"quota|rate.?limit", lc):
        return "rate_limited"
    if status == 404:
        return "not_found"
    if status == 400:
        return "bad_request"
    return "upstream"


def _classify_transport_error(err: BaseException) -> CallWorkspaceErrorCode:
    text = repr(err).lower()
    if "timeout" in text or isinstance(err, asyncio.TimeoutError):
        return "timeout"
    if re.search(
        r"peer cert|certificate|connection|tls|ssl|dns|resolve|network|os error",
        text,
    ):
        return "network"
    return "upstream"


def _truncate(payload: Any) -> tuple[Any, bool]:
    """Cap the JSON-serialised response so a runaway list endpoint can't
    blow up the model's context. Returns `(value, truncated)`."""
    try:
        encoded = json.dumps(payload).encode("utf-8")
    except (TypeError, ValueError):
        return payload, False
    if len(encoded) <= MAX_RESPONSE_BYTES:
        return payload, False
    truncated = encoded[:MAX_RESPONSE_BYTES].decode("utf-8", errors="ignore")
    # Re-parse only if it's still valid JSON; otherwise just return raw text.
    try:
        return json.loads(truncated), True
    except json.JSONDecodeError:
        return truncated, True


def _build_client(service: str, access_token: str) -> Any:
    """Imports kept lazy so this module is callable without
    google-api-python-client on the path (handy for typecheck / unit tests
    that monkeypatch this function)."""
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build

    api_name, version = _API_VERSIONS[service]
    creds = Credentials(token=access_token)  # type: ignore[no-untyped-call]
    return build(api_name, version, credentials=creds, cache_discovery=False)


async def call_workspace(
    *,
    access_token: str,
    service: str,
    resource: str,
    method: str,
    params: str | None = None,
    timeout_s: float = DEFAULT_TIMEOUT_S,
    build_client: Any | None = None,
) -> CallWorkspaceResult:
    """Dispatch a single Workspace API call.

    `params` is a JSON-encoded *string* matching the LLM's tool surface.
    Body fields under a `requestBody` key are split off and passed via
    the discovery client's `body=` argument.

    `build_client` is injectable for tests. Defaults to the real
    google-api-python-client builder.
    """
    if service not in _API_VERSIONS:
        return CallWorkspaceErr(
            status="error", code="invalid_args", message=f"unknown service: {service}"
        )

    parsed_params: dict[str, Any] = {}
    if params:
        try:
            decoded = json.loads(params)
        except json.JSONDecodeError as err:
            return CallWorkspaceErr(
                status="error", code="invalid_args", message=f"params is not valid JSON: {err}"
            )
        if not isinstance(decoded, dict):
            return CallWorkspaceErr(
                status="error", code="invalid_args", message="params must be a JSON object"
            )
        parsed_params = decoded

    try:
        path_query, body = _split_request_body(parsed_params)
    except ValueError as err:
        return CallWorkspaceErr(status="error", code="invalid_args", message=str(err))

    builder = build_client or _build_client
    try:
        client = await asyncio.to_thread(builder, service, access_token)
    except Exception as err:  # noqa: BLE001
        return CallWorkspaceErr(
            status="error", code=_classify_transport_error(err), message=str(err)
        )

    try:
        resource_obj = _walk_resource(client, resource)
    except ValueError as err:
        return CallWorkspaceErr(status="error", code="invalid_args", message=str(err))

    method_callable = getattr(resource_obj, method, None)
    if method_callable is None or not callable(method_callable):
        return CallWorkspaceErr(
            status="error",
            code="invalid_args",
            message=f"unknown method {method!r} on resource {resource!r}",
        )

    try:
        kwargs = dict(path_query)
        if body is not None:
            kwargs["body"] = body
        request = method_callable(**kwargs)
        result = await asyncio.wait_for(asyncio.to_thread(request.execute), timeout=timeout_s)
    except TimeoutError:
        return CallWorkspaceErr(
            status="error", code="timeout", message=f"request exceeded {timeout_s}s"
        )
    except Exception as err:  # noqa: BLE001
        # google-api-python-client raises HttpError with .resp.status set.
        status = int(getattr(getattr(err, "resp", None), "status", 0) or 0)
        message = str(err)
        if status:
            return CallWorkspaceErr(
                status="error", code=_classify_http_error(status, message), message=message
            )
        return CallWorkspaceErr(
            status="error", code=_classify_transport_error(err), message=message
        )

    truncated_body, was_truncated = _truncate(result)
    return CallWorkspaceOk(status="ok", body=truncated_body, truncated=was_truncated)
