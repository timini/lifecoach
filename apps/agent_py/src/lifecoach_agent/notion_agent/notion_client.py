"""Notion API dispatcher.

Generic httpx-based dispatcher for the Notion REST API. Every tool in
this module routes through here so error classification (scope_required
/ rate_limited / forbidden / not_found / bad_request / network /
timeout / upstream) is consistent across the surface — matching the
codes the prompt's NOTION error-handling block reasons over.

Tokens are NEVER on the params or body — `run_notion.run_notion()`
resolves them via the token store and threads them in as the
`access_token` parameter. The dispatcher injects them into the
`Authorization` header just before sending.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

import httpx

NOTION_API_BASE = "https://api.notion.com"
NOTION_API_VERSION = "2022-06-28"

# Cap response body size at 32 KB to bound LLM-visible payload and
# protect SSE / Firestore from accidental large-list pagination dumps.
MAX_RESPONSE_BYTES = 32 * 1024
DEFAULT_TIMEOUT_S = 20.0


CallNotionErrorCode = Literal[
    "scope_required",
    "forbidden",
    "rate_limited",
    "not_found",
    "bad_request",
    "network",
    "timeout",
    "upstream",
]


@dataclass(frozen=True)
class CallNotionOk:
    status: Literal["ok"] = "ok"
    body: Any = None
    truncated: bool = False


@dataclass(frozen=True)
class CallNotionErr:
    status: Literal["error"]
    code: CallNotionErrorCode
    message: str


CallNotionResult = CallNotionOk | CallNotionErr


def _classify_http_status(status_code: int, body_text: str) -> CallNotionErrorCode:
    """Map a Notion HTTP status code to our error vocabulary.

    Notion's responses also include `code` and `message` JSON fields,
    but for error classification the status code alone is sufficient.
    The Notion message text is propagated to the caller as-is so the
    LLM can reflect specifics ("page archived") back to the user.
    """
    if status_code == 401:
        return "scope_required"
    if status_code == 403:
        return "forbidden"
    if status_code == 404:
        return "not_found"
    if status_code == 429:
        return "rate_limited"
    if 400 <= status_code < 500:
        return "bad_request"
    return "upstream"


def _truncate_body(body: Any) -> tuple[Any, bool]:
    """If a parsed JSON body serialises to more than MAX_RESPONSE_BYTES,
    return the original alongside `truncated=True`. The LLM-visible
    layer reads `truncated` and tells the user the listing was capped.

    We intentionally don't slice the JSON itself — partial JSON is
    worthless to the LLM. The wrapping tool decides whether to call
    again with a tighter filter or hand back a summary instead.
    """
    import json as _json

    try:
        size = len(_json.dumps(body))
    except (TypeError, ValueError):
        return body, False
    return body, size > MAX_RESPONSE_BYTES


async def call_notion(
    *,
    access_token: str,
    method: Literal["GET", "POST", "PATCH", "DELETE"],
    path: str,
    body: Any = None,
    http: httpx.AsyncClient | None = None,
    timeout_s: float = DEFAULT_TIMEOUT_S,
) -> CallNotionResult:
    """Send one request to the Notion API and return a classified result.

    `path` is relative — e.g. `/v1/pages/{id}` or `/v1/databases`.
    The base URL + `Notion-Version` header are added here so callers
    don't repeat them.
    """
    url = f"{NOTION_API_BASE}{path}"
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Notion-Version": NOTION_API_VERSION,
        "Accept": "application/json",
    }
    if body is not None:
        headers["Content-Type"] = "application/json"

    # Allow the caller to inject an AsyncClient for tests; default
    # to a per-call client which is fine at our request volumes.
    owns_client = False
    if http is None:
        http = httpx.AsyncClient(timeout=timeout_s)
        owns_client = True

    try:
        try:
            res = await http.request(method, url, json=body, headers=headers)
        except httpx.TimeoutException as err:
            return CallNotionErr(status="error", code="timeout", message=str(err))
        except httpx.HTTPError as err:
            return CallNotionErr(status="error", code="network", message=str(err))
    finally:
        if owns_client:
            await http.aclose()

    if 200 <= res.status_code < 300:
        try:
            payload = res.json()
        except ValueError as err:
            return CallNotionErr(
                status="error",
                code="upstream",
                message=f"non-JSON response from Notion: {err}",
            )
        truncated_payload, truncated = _truncate_body(payload)
        return CallNotionOk(status="ok", body=truncated_payload, truncated=truncated)

    body_text = res.text[:200] if isinstance(res.text, str) else ""
    code = _classify_http_status(res.status_code, body_text)

    # Extract Notion's own `message` field when available; it's friendlier
    # than the raw body. The LLM may reflect it back to the user.
    message = body_text
    try:
        err_payload = res.json()
        if isinstance(err_payload, dict):
            notion_message = err_payload.get("message")
            if isinstance(notion_message, str) and notion_message:
                message = notion_message
    except ValueError:
        pass

    return CallNotionErr(status="error", code=code, message=message)
