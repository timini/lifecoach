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
