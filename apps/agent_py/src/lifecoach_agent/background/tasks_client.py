"""Cloud Tasks enqueue boundary for the dispatcher (ADR 0001, step 5a).

The dispatcher enqueues one HTTP task per due run. The task carries only
identifiers (never OAuth tokens or email data — ADR §3) and an OIDC token so
Cloud Tasks authenticates to the executor endpoint as the invoker SA.

``CreateTask`` returning ``ALREADY_EXISTS`` is treated as **success** (ADR §4):
the deterministic task id means a prior enqueue already happened, so the run
is already queued/executing — do not retry, do not error.
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from typing import Any, Protocol


@dataclass(frozen=True)
class TaskRequest:
    """Everything needed to enqueue one run-execute task."""

    task_id: str
    url: str
    payload: dict[str, Any]
    oidc_service_account_email: str
    oidc_audience: str


class BackgroundTasksClient(Protocol):
    async def enqueue(self, req: TaskRequest) -> bool:
        """Enqueue a task. Returns True if newly created, False if it already
        existed (both are success — never raise on ALREADY_EXISTS)."""
        ...


class CloudTasksClient:
    """Real client over ``google-cloud-tasks``. The low-level client + queue
    path are injectable so tests can drive ALREADY_EXISTS without the SDK."""

    def __init__(self, *, client: Any, queue_path: str) -> None:
        self._client = client
        self._queue_path = queue_path

    @classmethod
    def from_env(cls, *, project: str, location: str, queue: str) -> CloudTasksClient:
        from google.cloud import tasks_v2

        client = tasks_v2.CloudTasksClient()
        queue_path = client.queue_path(project, location, queue)
        return cls(client=client, queue_path=queue_path)

    async def enqueue(self, req: TaskRequest) -> bool:
        from google.api_core import exceptions as gax_exceptions

        task = {
            "name": f"{self._queue_path}/tasks/{req.task_id}",
            "http_request": {
                "http_method": "POST",
                "url": req.url,
                "headers": {"Content-Type": "application/json"},
                "body": json.dumps(req.payload).encode("utf-8"),
                "oidc_token": {
                    "service_account_email": req.oidc_service_account_email,
                    "audience": req.oidc_audience,
                },
            },
        }

        def _create() -> bool:
            try:
                self._client.create_task(parent=self._queue_path, task=task)
                return True
            except gax_exceptions.AlreadyExists:
                return False

        return await asyncio.to_thread(_create)
