"""Project a raw `gmail.users.messages.get` (format=full) response into
the shape the LLM can actually read:

- `body.data` is base64url-encoded by the Gmail API (RFC 4648 §5). We
  walk the payload tree, pick the first text/plain part, fall back to
  text/html with a tag-strip if no plain part exists, and decode.
- `payload.headers` is bloated with DKIM / ARC / Received chains we
  don't need. We allow-list the few that matter for triage.
- The body is capped at 4 KB so a single chunky email can't blow the
  sub-agent's context budget.
"""

from __future__ import annotations

import base64
import re
from typing import Any

from lifecoach_agent.contracts.models import MessageProjection

_ALLOWED_HEADERS: frozenset[str] = frozenset(
    {
        "from",
        "to",
        "cc",
        "bcc",
        "subject",
        "date",
        "reply-to",
        "list-unsubscribe",
        "message-id",
        "in-reply-to",
        "references",
    }
)

BODY_BYTE_CAP = 4096
_TRUNCATION_MARKER = "\n…[truncated]"


def project_gmail_message(raw: dict[str, Any]) -> MessageProjection:
    payload = raw.get("payload") or {}
    header_map = _collect_headers(payload.get("headers") or [])
    body, truncated = _pick_body(payload)

    filtered_headers = _filter_headers(header_map)
    return MessageProjection.model_validate(
        {
            "id": raw.get("id") or "",
            "threadId": raw.get("threadId") or raw.get("id") or "",
            "from": header_map.get("from", ""),
            "subject": header_map.get("subject", ""),
            "date": header_map.get("date", ""),
            "snippet": raw.get("snippet") or "",
            "body": body,
            "truncated": truncated,
            **({"headers": filtered_headers} if filtered_headers else {}),
        }
    )


def _collect_headers(headers: list[dict[str, Any]]) -> dict[str, str]:
    out: dict[str, str] = {}
    for h in headers:
        name = h.get("name")
        if not name:
            continue
        key = name.lower()
        # First wins — RFC 5322 says repeated headers are unusual; the
        # first is typically the canonical one when Gmail returns multiples.
        if key not in out:
            out[key] = h.get("value") or ""
    return out


def _filter_headers(header_map: dict[str, str]) -> dict[str, str]:
    out: dict[str, str] = {}
    for key, value in header_map.items():
        if key not in _ALLOWED_HEADERS:
            continue
        # Skip the headers we've already promoted to top-level fields.
        if key in {"from", "subject", "date"}:
            continue
        out[_canonicalise_header_name(key)] = value
    return out


def _canonicalise_header_name(lower: str) -> str:
    return "-".join(seg[:1].upper() + seg[1:] if seg else seg for seg in lower.split("-"))


def _pick_body(payload: dict[str, Any]) -> tuple[str, bool]:
    plain = _find_part(payload, "text/plain")
    if plain is not None:
        return _decode_and_cap((plain.get("body") or {}).get("data") or "")
    html = _find_part(payload, "text/html")
    if html is not None:
        decoded, was_truncated = _decode_and_cap((html.get("body") or {}).get("data") or "")
        return _strip_html(decoded), was_truncated
    top = payload.get("body") or {}
    if top.get("data"):
        return _decode_and_cap(top["data"])
    return "", False


def _find_part(part: dict[str, Any], mime: str) -> dict[str, Any] | None:
    if part.get("mimeType") == mime and (part.get("body") or {}).get("data"):
        return part
    for child in part.get("parts") or []:
        hit = _find_part(child, mime)
        if hit is not None:
            return hit
    return None


def _decode_and_cap(b64url: str) -> tuple[str, bool]:
    if not b64url:
        return "", False
    try:
        # urlsafe_b64decode tolerates missing padding once we re-pad to
        # a multiple of 4 — Gmail's base64url drops trailing `=`.
        pad = (-len(b64url)) % 4
        raw = base64.urlsafe_b64decode(b64url + ("=" * pad))
    except (ValueError, base64.binascii.Error):  # type: ignore[attr-defined]
        return "", False
    decoded = raw.decode("utf-8", errors="replace")
    encoded = decoded.encode("utf-8")
    if len(encoded) <= BODY_BYTE_CAP:
        return decoded, False
    capped = encoded[:BODY_BYTE_CAP].decode("utf-8", errors="ignore")
    return capped + _TRUNCATION_MARKER, True


_STYLE_RE = re.compile(r"<style[\s\S]*?</style>", re.IGNORECASE)
_SCRIPT_RE = re.compile(r"<script[\s\S]*?</script>", re.IGNORECASE)
_TAG_RE = re.compile(r"<[^>]+>")
_WHITESPACE_RE = re.compile(r"\s+")
_ENTITY_MAP = {
    "&nbsp;": " ",
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
}


def _strip_html(html: str) -> str:
    out = _STYLE_RE.sub("", html)
    out = _SCRIPT_RE.sub("", out)
    out = _TAG_RE.sub(" ", out)
    for entity, replacement in _ENTITY_MAP.items():
        out = out.replace(entity, replacement)
    return _WHITESPACE_RE.sub(" ", out).strip()
