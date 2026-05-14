from __future__ import annotations

import base64
import json
import os
import re
import traceback
import urllib.error
import urllib.request
from typing import Any
from urllib.parse import urlparse

TRACEBACK_RE = re.compile(r"^Traceback \(most recent call last\):", re.MULTILINE)
FILE_FRAME_RE = re.compile(
    r'^\s*File "(?P<filename>.+?)", line (?P<lineno>\d+), in (?P<function>.+)$'
)
ERROR_LINE_RE = re.compile(
    r"^(?P<type>[\w.]+(?:Error|Exception|Warning|Exit|Interrupt)?): (?P<value>.*)$"
)


def forward_cloud_log_to_sentry(request: Any) -> tuple[str, int]:
    """Forward a Cloud Logging Pub/Sub push envelope to Sentry's Store API."""
    try:
        envelope = request.get_json(silent=True) or {}
        entry = _decode_pubsub_message(envelope)
        event = build_sentry_event(entry)
        post_to_sentry(event)
    except Exception:
        traceback.print_exc()
        return ("failed", 500)

    return ("ok", 204)


def _decode_pubsub_message(envelope: dict[str, Any]) -> dict[str, Any]:
    encoded = envelope.get("message", {}).get("data")
    if not encoded:
        raise ValueError("missing Pub/Sub message.data")

    decoded = base64.b64decode(encoded).decode("utf-8")
    payload = json.loads(decoded)
    if not isinstance(payload, dict):
        raise ValueError("Cloud Logging payload must be a JSON object")
    return payload


def build_sentry_event(entry: dict[str, Any]) -> dict[str, Any]:
    text = _payload_text(entry)
    resource_labels = entry.get("resource", {}).get("labels", {})
    service = resource_labels.get("service_name")
    revision = resource_labels.get("revision_name")
    error_group_id = entry.get("errorGroups", [{}])[0].get("id")
    parsed = _parse_python_traceback(text)

    event: dict[str, Any] = {
        "level": "error",
        "platform": "python" if parsed else "other",
        "timestamp": entry.get("timestamp"),
        "logger": entry.get("logName"),
        "tags": {
            "source": "cloud_logs",
            "service": service,
            "revision": revision,
            "logName": entry.get("logName"),
            "cloud_run_location": resource_labels.get("location"),
        },
        "extra": {
            "cloud_log_insert_id": entry.get("insertId"),
            "cloud_log_resource": entry.get("resource"),
            "cloud_log_labels": entry.get("labels"),
        },
    }

    environment = os.environ.get("SENTRY_ENVIRONMENT")
    if environment:
        event["environment"] = environment

    if error_group_id:
        event["fingerprint"] = ["cloud-logging-error-group", error_group_id]
        event["tags"]["error_group_id"] = error_group_id
    else:
        event["fingerprint"] = ["cloud-logs", service or "unknown", _first_line(text)]

    if parsed:
        event["exception"] = {"values": [parsed]}
        event["message"] = f"{parsed['type']}: {parsed['value']}"
    else:
        event["message"] = (
            text or entry.get("jsonPayload", {}).get("message") or "Cloud Run error log"
        )

    event["tags"] = {k: v for k, v in event["tags"].items() if v is not None}
    event["extra"] = {k: v for k, v in event["extra"].items() if v is not None}
    return event


def _payload_text(entry: dict[str, Any]) -> str:
    text_payload = entry.get("textPayload")
    if isinstance(text_payload, str):
        return text_payload.strip()

    json_payload = entry.get("jsonPayload")
    if isinstance(json_payload, dict):
        message = json_payload.get("message")
        if isinstance(message, str):
            return message.strip()
        return json.dumps(json_payload, sort_keys=True)

    proto_payload = entry.get("protoPayload")
    if isinstance(proto_payload, dict):
        status = proto_payload.get("status")
        if isinstance(status, dict) and status.get("message"):
            return str(status["message"]).strip()
        return json.dumps(proto_payload, sort_keys=True)

    return ""


def _parse_python_traceback(text: str) -> dict[str, Any] | None:
    if not TRACEBACK_RE.search(text):
        return None

    frames: list[dict[str, Any]] = []
    lines = text.splitlines()
    for index, line in enumerate(lines):
        match = FILE_FRAME_RE.match(line)
        if not match:
            continue

        frame = {
            "filename": match.group("filename"),
            "lineno": int(match.group("lineno")),
            "function": match.group("function"),
            "in_app": True,
        }
        if index + 1 < len(lines):
            context_line = lines[index + 1].strip()
            if context_line:
                frame["context_line"] = context_line
        frames.append(frame)

    error_type = "CloudRunStderrTraceback"
    error_value = _first_line(text)
    for line in reversed(lines):
        match = ERROR_LINE_RE.match(line.strip())
        if match:
            error_type = match.group("type")
            error_value = match.group("value")
            break

    return {
        "type": error_type,
        "value": error_value,
        "stacktrace": {"frames": frames},
    }


def post_to_sentry(event: dict[str, Any]) -> None:
    dsn = os.environ.get("SENTRY_DSN", "")
    if not dsn:
        raise RuntimeError("SENTRY_DSN is required")

    parsed = urlparse(dsn)
    public_key = parsed.username
    project_id = parsed.path.strip("/").split("/")[-1]
    if not parsed.scheme or not parsed.hostname or not public_key or not project_id:
        raise ValueError("SENTRY_DSN must be a valid Sentry DSN")

    url = f"{parsed.scheme}://{parsed.hostname}/api/{project_id}/store/"
    body = json.dumps(event).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "X-Sentry-Auth": (
                "Sentry sentry_version=7, "
                f"sentry_key={public_key}, "
                "sentry_client=lifecoach-cloud-logs-to-sentry/1.0"
            ),
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            if response.status >= 300:
                raise RuntimeError(f"Sentry returned HTTP {response.status}")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Sentry returned HTTP {exc.code}: {detail}") from exc


def _first_line(text: str) -> str:
    return next(
        (line.strip() for line in text.splitlines() if line.strip()),
        "Cloud Run error log",
    )
