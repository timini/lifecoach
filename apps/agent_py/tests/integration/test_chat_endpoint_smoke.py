"""End-to-end smoke test: POST /chat against a deployed agent URL.

Verifies that a one-word "hi" greeting produces (a) no `event: error`,
(b) at least one assistant text token. Doesn't judge content quality —
that's `e2e/chat-quality.spec.ts`'s job. This test exists so silent
turns from prompt-template failures (e.g. literal `{name}` placeholders
that ADK can't resolve) fail loudly at the agent boundary.

Gated on `LIFECOACH_E2E_AGENT_URL` so it doesn't run in default unit
suites — point it at the per-PR preview agent (e.g.
`https://lifecoach-agent-pr-59-qgfgyxttjq-uc.a.run.app`).

Usage:
    LIFECOACH_E2E_AGENT_URL=https://...a.run.app \\
      uv run pytest tests/integration/test_chat_endpoint_smoke.py -v
"""

from __future__ import annotations

import json
import os
import secrets

import httpx
import pytest


def _agent_url() -> str | None:
    return os.environ.get("LIFECOACH_E2E_AGENT_URL")


pytestmark = pytest.mark.skipif(
    _agent_url() is None,
    reason="set LIFECOACH_E2E_AGENT_URL to run agent smoke tests",
)


def _parse_sse(body: str) -> list[tuple[str, dict | None]]:
    """Parse an SSE stream body into [(event_type, data_dict)]."""
    out: list[tuple[str, dict | None]] = []
    for block in body.split("\n\n"):
        block = block.strip()
        if not block:
            continue
        event_type = "message"
        data_lines: list[str] = []
        for line in block.split("\n"):
            if line.startswith(":"):
                continue
            if line.startswith("event:"):
                event_type = line.removeprefix("event:").strip()
            elif line.startswith("data:"):
                data_lines.append(line.removeprefix("data:").strip())
        raw = "\n".join(data_lines).strip()
        if not raw:
            out.append((event_type, None))
            continue
        try:
            out.append((event_type, json.loads(raw)))
        except json.JSONDecodeError:
            out.append((event_type, None))
    return out


@pytest.mark.parametrize("message", ["hi", "hello", "good morning"])
def test_chat_returns_substantive_reply_on_simple_greeting(message: str) -> None:
    """A one-word greeting must produce a non-error stream with at
    least one assistant text part. This is the silent-turn guard."""
    base = _agent_url()
    assert base is not None
    uid = f"e2e-smoke-{secrets.token_hex(4)}"
    sid = f"{uid}-2026-05-11"
    body = {
        "userId": uid,
        "sessionId": sid,
        "message": message,
        "timezone": "Europe/London",
    }
    with httpx.Client(timeout=30.0) as client:
        res = client.post(f"{base}/chat", json=body)
        assert res.status_code == 200, f"status {res.status_code}: {res.text[:200]}"
        events = _parse_sse(res.text)

    # 1. No `event: error` — those are server-side exceptions surfaced
    #    to the FE. Any error here is a regression of the silent-turn
    #    class.
    errors = [(t, d) for (t, d) in events if t == "error"]
    assert not errors, (
        f"agent emitted error events for {message!r}: "
        + ", ".join((d or {}).get("message", "") for _, d in errors)
    )

    # 2. At least one assistant text token. Any assistant content
    #    counts — text part, function call, the lot — as long as the
    #    model produced *something*.
    has_assistant_content = False
    for evt_type, data in events:
        if evt_type != "message" or not isinstance(data, dict):
            continue
        # ADK event with parts.
        content = data.get("content") or {}
        parts = content.get("parts") or []
        for p in parts:
            if not isinstance(p, dict):
                continue
            if (
                (isinstance(p.get("text"), str) and p["text"].strip())
                or isinstance(p.get("functionCall"), dict)
                or isinstance(p.get("functionResponse"), dict)
            ):
                has_assistant_content = True
                break
        if has_assistant_content:
            break
    assert has_assistant_content, (
        f"agent produced no assistant content for {message!r} — silent turn. "
        f"events: {[t for t, _ in events]}"
    )
