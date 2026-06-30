"""Unit tests for the Cloud Tasks enqueue boundary (ADR 0001 §4, step 5a)."""

from __future__ import annotations

import json

import pytest
from google.api_core import exceptions as gax

from lifecoach_agent.background.tasks_client import CloudTasksClient, TaskRequest

pytestmark = pytest.mark.asyncio

_QUEUE = "projects/p/locations/us-central1/queues/background-agent-runs"


class _FakeLowLevel:
    def __init__(self, *, raise_already: bool = False) -> None:
        self.created: list[dict[str, object]] = []
        self._raise = raise_already

    def create_task(self, *, parent: str, task: dict[str, object]) -> None:
        if self._raise:
            raise gax.AlreadyExists("duplicate task name")
        self.created.append(task)


def _req() -> TaskRequest:
    return TaskRequest(
        task_id="background-email_triage_daily-abc-20260515T080000Z-7f9e2a",
        url="https://agent.run.app/background/runs/run_x/execute",
        payload={"runId": "run_x", "uid": "uid-1"},
        oidc_service_account_email="background-invoker@p.iam.gserviceaccount.com",
        oidc_audience="https://agent.run.app",
    )


async def test_enqueue_creates_task_with_oidc_and_json_body() -> None:
    low = _FakeLowLevel()
    client = CloudTasksClient(client=low, queue_path=_QUEUE)
    assert await client.enqueue(_req()) is True

    task = low.created[0]
    assert task["name"].endswith("/tasks/background-email_triage_daily-abc-20260515T080000Z-7f9e2a")
    http = task["http_request"]
    assert http["http_method"] == "POST"
    assert http["url"] == "https://agent.run.app/background/runs/run_x/execute"
    assert http["oidc_token"] == {
        "service_account_email": "background-invoker@p.iam.gserviceaccount.com",
        "audience": "https://agent.run.app",
    }
    assert json.loads(http["body"]) == {"runId": "run_x", "uid": "uid-1"}


async def test_enqueue_already_exists_is_success_not_error() -> None:
    client = CloudTasksClient(client=_FakeLowLevel(raise_already=True), queue_path=_QUEUE)
    # ALREADY_EXISTS → False (already enqueued) but never raises (ADR §4).
    assert await client.enqueue(_req()) is False
