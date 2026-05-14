"""Forward selected Cloud Logging entries from Pub/Sub push to Sentry.

Flow: Cloud Logging project sink -> Pub/Sub topic -> authenticated push
subscription -> this HTTP Cloud Function (2nd gen) -> Sentry Store API.

The in-app Sentry SDKs are the primary capture path. This forwarder catches
failures the in-process SDK cannot see: stderr-only library tracebacks,
OOM/SIGKILL container exits before flush, and Google-managed infra-side
errors that only surface in Cloud Logging.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

CLIENT = "lifecoach-cloud-logs-forwarder/1.0"
TRACEBACK_HEADER_RE = re.compile(r"^Traceback \(most recent call last\):", re.MULTILINE)
PYTHON_FRAME_RE = re.compile(
    r'^  File "(?P<filename>.+?)", line (?P<lineno>\d+), in (?P<function>.+)$'
)
EXCEPTION_LINE_RE = re.compile(
    r"^(?P<type>[\w.]+(?:Error|Exception|Exit|Interrupt|Warning)?): (?P<value>.*)$"
)


def _json_response(payload: dict[str, Any], status: int = 200) -> tuple[str, int, dict[str, str]]:
    return json.dumps(payload, separators=(",", ":")), status, {"Content-Type": "application/json"}


def _decode_pubsub_push(request: Any) -> dict[str, Any]:
    envelope = request.get_json(silent=True) or {}
    message = envelope.get("message") or {}
    data = message.get("data")
    if not data:
        raise ValueError("missing Pub/Sub message.data")

    decoded = base64.b64decode(data).decode("utf-8")
    return json.loads(decoded)


def _payload_text(entry: dict[str, Any]) -> str:
    if isinstance(entry.get("textPayload"), str):
        return entry["textPayload"]
    for key in ("jsonPayload", "protoPayload"):
        payload = entry.get(key)
        if payload is not None:
            return json.dumps(payload, sort_keys=True, default=str)
    return entry.get("insertId") or "Cloud Logging error"


def _service_labels(entry: dict[str, Any]) -> dict[str, str]:
    labels = (entry.get("resource") or {}).get("labels") or {}
    return {
        "service": labels.get("service_name", ""),
        "revision": labels.get("revision_name", ""),
    }


def _parse_python_traceback(text: str) -> tuple[dict[str, Any] | None, str | None]:
    if not TRACEBACK_HEADER_RE.search(text):
        return None, None

    frames: list[dict[str, Any]] = []
    exception_type = "Error"
    exception_value = text.strip().splitlines()[-1] if text.strip() else "Cloud Logging error"
    lines = text.splitlines()

    for line in lines:
        frame_match = PYTHON_FRAME_RE.match(line)
        if frame_match:
            frame = frame_match.groupdict()
            frames.append(
                {
                    "filename": frame["filename"],
                    "lineno": int(frame["lineno"]),
                    "function": frame["function"].strip(),
                    "in_app": True,
                }
            )

    for line in reversed(lines):
        match = EXCEPTION_LINE_RE.match(line.strip())
        if match:
            exception_type = match.group("type")
            exception_value = match.group("value")
            break

    return (
        {
            "values": [
                {
                    "type": exception_type,
                    "value": exception_value,
                    "stacktrace": {"frames": frames},
                }
            ]
        },
        f"{exception_type}: {exception_value}",
    )


def build_event_id(entry: dict[str, Any]) -> str:
    """Deterministic 32-char hex Sentry event_id derived from the full log identity.

    Sentry uses event_id as the canonical event identifier; if two distinct log
    entries collide on event_id, Sentry treats them as duplicates. We hash the
    full (logName | insertId | timestamp) tuple so that distinct entries — even
    when they share the common `projects/<project>/logs/` prefix on logName —
    yield distinct event_ids. (PR 113 review P1: truncating the raw identity
    before hashing meant the shared prefix dominated and collisions happened.)
    """
    parts = (
        entry.get("logName") or "",
        entry.get("insertId") or "",
        entry.get("timestamp") or entry.get("receiveTimestamp") or "",
    )
    identity = "|".join(str(part) for part in parts)
    digest = hashlib.sha256(identity.encode("utf-8")).hexdigest()
    return digest[:32]


def build_sentry_event(entry: dict[str, Any]) -> dict[str, Any]:
    text = _payload_text(entry)
    labels = _service_labels(entry)
    error_group_id = ((entry.get("errorGroups") or [{}])[0] or {}).get("id")
    exception, parsed_message = _parse_python_traceback(text)

    event: dict[str, Any] = {
        "event_id": build_event_id(entry),
        "timestamp": entry.get("timestamp") or time.time(),
        "platform": "python",
        "level": "error",
        "logger": "cloud_logging",
        "environment": os.environ.get("SENTRY_ENVIRONMENT", "unknown"),
        "message": parsed_message or text[:8192],
        "fingerprint": (
            [error_group_id]
            if error_group_id
            else [labels["service"] or "cloud_run", text[:120]]
        ),
        "tags": {
            "source": "cloud_logs",
            "service": labels["service"],
            "revision": labels["revision"],
            "logName": entry.get("logName", ""),
            "severity": entry.get("severity", ""),
        },
        "extra": {
            "insertId": entry.get("insertId"),
            "resource": entry.get("resource"),
            "labels": entry.get("labels"),
            "trace": entry.get("trace"),
            "spanId": entry.get("spanId"),
        },
    }
    if exception is not None:
        event["exception"] = exception
    return event


def _store_endpoint(dsn: str) -> tuple[str, str]:
    parsed = urllib.parse.urlparse(dsn)
    if not parsed.scheme or not parsed.hostname or not parsed.username:
        raise ValueError("invalid SENTRY_DSN")
    project_id = parsed.path.rstrip("/").split("/")[-1]
    if not project_id:
        raise ValueError("invalid SENTRY_DSN project id")
    path_prefix = "/".join(parsed.path.rstrip("/").split("/")[:-1])
    endpoint = urllib.parse.urlunparse(
        (parsed.scheme, parsed.hostname, f"{path_prefix}/api/{project_id}/store/", "", "", "")
    )
    return endpoint, parsed.username


def post_to_sentry(event: dict[str, Any]) -> None:
    dsn = os.environ["SENTRY_DSN"]
    endpoint, public_key = _store_endpoint(dsn)
    payload = json.dumps(event, separators=(",", ":"), default=str).encode("utf-8")
    request = urllib.request.Request(
        endpoint,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "User-Agent": CLIENT,
            "X-Sentry-Auth": (
                "Sentry sentry_version=7, "
                f"sentry_client={CLIENT}, "
                f"sentry_key={public_key}"
            ),
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        response.read()


def forward_log_entry(request: Any) -> tuple[str, int, dict[str, str]]:
    if request.method != "POST":
        return _json_response({"error": "method not allowed"}, 405)

    try:
        entry = _decode_pubsub_push(request)
        event = build_sentry_event(entry)
        post_to_sentry(event)
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        print(f"Sentry Store API returned HTTP {error.code}: {body}")
        return _json_response({"error": "sentry rejected event"}, 500)
    except Exception as error:  # Cloud Functions should retry transient decode/Sentry failures.
        print("Failed to forward Cloud Logging entry to Sentry")
        traceback.print_exc()
        return _json_response({"error": str(error)}, 500)

    return _json_response({"ok": True})
