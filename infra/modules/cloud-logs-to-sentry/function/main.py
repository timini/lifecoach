import base64
import json
import os
import re
import traceback
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

_TRACEBACK_RE = re.compile(
    r"Traceback \(most recent call last\):\n(?P<frames>.*?)(?P<type>[\w.]+)(?:: (?P<value>.*))?$",
    re.DOTALL,
)
_FRAME_RE = re.compile(
    r'  File "(?P<filename>.+?)", line (?P<lineno>\d+), in (?P<function>.+)'
)


def forward_cloud_log(request: Any) -> tuple[str, int]:
    """HTTP Pub/Sub push target that forwards a Cloud Logging entry to Sentry."""
    envelope = request.get_json(silent=True) or {}
    message = envelope.get("message") or {}
    encoded_data = message.get("data")
    if not encoded_data:
        return "missing Pub/Sub data", 204

    try:
        entry = json.loads(base64.b64decode(encoded_data).decode("utf-8"))
        event = _build_sentry_event(entry)
        _post_to_sentry(event)
    except Exception:
        traceback.print_exc()
        return "forward failed", 500

    return "ok", 204


def _build_sentry_event(entry: dict[str, Any]) -> dict[str, Any]:
    text = _payload_text(entry)
    labels = entry.get("resource", {}).get("labels", {})
    error_group_id = (entry.get("errorGroups") or [{}])[0].get("id")

    event: dict[str, Any] = {
        "event_id": _event_id(entry),
        "timestamp": entry.get("timestamp") or entry.get("receiveTimestamp"),
        "platform": "python",
        "level": "error",
        "logger": entry.get("logName"),
        "server_name": labels.get("service_name"),
        "environment": os.environ.get("SENTRY_ENVIRONMENT"),
        "message": text[:8192] if text else "Cloud Run error log",
        "fingerprint": (
            [error_group_id]
            if error_group_id
            else [entry.get("logName", "cloud_logs"), text[:200]]
        ),
        "tags": {
            "source": "cloud_logs",
            "service": labels.get("service_name"),
            "revision": labels.get("revision_name"),
            "logName": entry.get("logName"),
        },
        "extra": {
            "insertId": entry.get("insertId"),
            "severity": entry.get("severity"),
            "resource": entry.get("resource"),
            "labels": entry.get("labels"),
            "errorGroups": entry.get("errorGroups"),
        },
    }

    exception = _parse_traceback(text)
    if exception:
        event["exception"] = {"values": [exception]}

    return {key: value for key, value in event.items() if value is not None}


def _payload_text(entry: dict[str, Any]) -> str:
    if isinstance(entry.get("textPayload"), str):
        return entry["textPayload"]
    if "jsonPayload" in entry:
        payload = entry["jsonPayload"]
        if isinstance(payload, dict):
            for key in ("message", "msg", "error"):
                if isinstance(payload.get(key), str):
                    return payload[key]
        return json.dumps(payload, sort_keys=True)
    if "protoPayload" in entry:
        return json.dumps(entry["protoPayload"], sort_keys=True)
    return ""


def _parse_traceback(text: str) -> dict[str, Any] | None:
    match = _TRACEBACK_RE.search(text.strip())
    if not match:
        return None

    frames = []
    for frame in _FRAME_RE.finditer(match.group("frames")):
        frames.append(
            {
                "filename": frame.group("filename"),
                "function": frame.group("function"),
                "lineno": int(frame.group("lineno")),
                "in_app": True,
            }
        )

    return {
        "type": match.group("type"),
        "value": match.group("value") or "",
        "stacktrace": {"frames": frames},
    }


def _event_id(entry: dict[str, Any]) -> str:
    raw = "|".join(
        str(part or "")
        for part in (entry.get("logName"), entry.get("insertId"), entry.get("timestamp"))
    )
    return (
        re.sub(r"[^a-f0-9]", "", base64.b16encode(raw.encode()).decode().lower())[:32]
        .ljust(32, "0")
    )


def _post_to_sentry(event: dict[str, Any]) -> None:
    dsn = os.environ["SENTRY_DSN"]
    parsed = urllib.parse.urlparse(dsn)
    path_parts = parsed.path.strip("/").split("/")
    project_id = path_parts[-1]
    path_prefix = "/".join(path_parts[:-1])
    store_path = (
        f"/{path_prefix}/api/{project_id}/store/"
        if path_prefix
        else f"/api/{project_id}/store/"
    )
    store_url = f"{parsed.scheme}://{parsed.netloc}{store_path}"
    auth = (
        "Sentry sentry_version=7, "
        f"sentry_key={parsed.username}, "
        "sentry_client=lifecoach-cloud-logs/1.0"
    )
    body = json.dumps(event, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(
        store_url,
        data=body,
        headers={"Content-Type": "application/json", "X-Sentry-Auth": auth},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            response.read()
    except urllib.error.HTTPError as exc:
        if 400 <= exc.code < 500 and exc.code != 429:
            body = exc.read().decode("utf-8")
            print(f"Sentry rejected Cloud Logging event with HTTP {exc.code}: {body}")
            return
        raise
