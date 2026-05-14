from __future__ import annotations

import importlib.util
import os
from pathlib import Path

MODULE_PATH = Path(__file__).resolve().parents[1] / "function" / "main.py"
spec = importlib.util.spec_from_file_location("cloud_logs_to_sentry_forwarder", MODULE_PATH)
forwarder = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(forwarder)


def test_build_sentry_event_parses_python_traceback() -> None:
    os.environ["SENTRY_ENVIRONMENT"] = "dev"
    entry = {
        "textPayload": 'Traceback (most recent call last):\n  File "/app/main.py", line 7, in run\n    raise ValueError("forward test")\nValueError: forward test',
        "severity": "ERROR",
        "logName": "projects/lifecoach/logs/run.googleapis.com%2Fstderr",
        "insertId": "abc-001",
        "timestamp": "2026-05-14T12:00:00Z",
        "resource": {
            "type": "cloud_run_revision",
            "labels": {
                "service_name": "lifecoach-agent",
                "revision_name": "lifecoach-agent-00042-abc",
            },
        },
        "errorGroups": [{"id": "CPnGn56-x6KLZg"}],
    }

    event = forwarder.build_sentry_event(entry)

    assert event["environment"] == "dev"
    assert event["fingerprint"] == ["CPnGn56-x6KLZg"]
    assert event["tags"]["source"] == "cloud_logs"
    assert event["tags"]["service"] == "lifecoach-agent"
    assert event["exception"]["values"][0]["type"] == "ValueError"
    assert event["exception"]["values"][0]["value"] == "forward test"
    assert event["exception"]["values"][0]["stacktrace"]["frames"] == [
        {"filename": "/app/main.py", "lineno": 7, "function": "run", "in_app": True}
    ]
    # event_id is a 32-char hex string and present.
    assert isinstance(event["event_id"], str)
    assert len(event["event_id"]) == 32
    assert all(ch in "0123456789abcdef" for ch in event["event_id"])


def test_build_sentry_event_uses_message_for_non_traceback_payload() -> None:
    entry = {
        "textPayload": "Container failed to start and listen on PORT=8080",
        "severity": "ERROR",
        "resource": {"labels": {"service_name": "lifecoach-web"}},
    }

    event = forwarder.build_sentry_event(entry)

    assert event["message"] == "Container failed to start and listen on PORT=8080"
    assert "exception" not in event
    assert event["fingerprint"] == ["lifecoach-web", "Container failed to start and listen on PORT=8080"]


def test_store_endpoint_supports_project_id_and_path_prefix() -> None:
    endpoint, public_key = forwarder._store_endpoint("https://abc123@sentry.example.com/456")

    assert public_key == "abc123"
    assert endpoint == "https://sentry.example.com/api/456/store/"

    prefixed_endpoint, _ = forwarder._store_endpoint("https://abc123@sentry.example.com/prefix/456")

    assert prefixed_endpoint == "https://sentry.example.com/prefix/api/456/store/"


def test_build_event_id_distinct_for_distinct_entries_sharing_logname_prefix() -> None:
    """Regression for PR 113 review P1.

    Two log entries with the same `projects/<project>/logs/...` logName but
    different insertId/timestamp must produce distinct event_ids — Sentry
    treats colliding event_ids as duplicate events.
    """
    common_logname = "projects/lifecoach-dev/logs/run.googleapis.com%2Fstderr"
    entry_a = {
        "logName": common_logname,
        "insertId": "insert-aaaaaaaa",
        "timestamp": "2026-05-14T12:00:00Z",
    }
    entry_b = {
        "logName": common_logname,
        "insertId": "insert-bbbbbbbb",
        "timestamp": "2026-05-14T12:00:00.000001Z",
    }

    id_a = forwarder.build_event_id(entry_a)
    id_b = forwarder.build_event_id(entry_b)

    assert id_a != id_b
    assert len(id_a) == 32 and len(id_b) == 32
    # Deterministic — same input must give same output.
    assert forwarder.build_event_id(entry_a) == id_a


def test_build_event_id_stable_under_missing_fields() -> None:
    """build_event_id must not raise when optional fields are absent."""
    event_id = forwarder.build_event_id({})
    assert isinstance(event_id, str)
    assert len(event_id) == 32


def test_build_sentry_event_fingerprint_falls_back_to_service_and_message() -> None:
    """When errorGroups is absent the fingerprint is [service, truncated text]."""
    entry = {
        "textPayload": "Something went wrong",
        "severity": "ERROR",
        "resource": {"labels": {"service_name": "lifecoach-web"}},
    }

    event = forwarder.build_sentry_event(entry)

    assert event["fingerprint"] == ["lifecoach-web", "Something went wrong"]


def test_parse_python_traceback_extracts_multiple_frames() -> None:
    text = (
        'Traceback (most recent call last):\n'
        '  File "/app/main.py", line 10, in main\n'
        '    do_work()\n'
        '  File "/app/work.py", line 22, in do_work\n'
        '    raise RuntimeError("boom")\n'
        'RuntimeError: boom'
    )

    exception, message = forwarder._parse_python_traceback(text)

    assert message == "RuntimeError: boom"
    assert exception is not None
    frames = exception["values"][0]["stacktrace"]["frames"]
    assert len(frames) == 2
    assert frames[0]["function"] == "main"
    assert frames[1]["function"] == "do_work"
    assert frames[1]["lineno"] == 22
