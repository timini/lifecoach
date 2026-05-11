"""Project a raw `tasks.tasks.list` / `tasks.tasks.get` response into the
shape the LLM consumes. Drops fields the coach doesn't need (`etag`,
`selfLink`, `kind`, `updated`, `position`, `links`).
"""

from __future__ import annotations

from typing import Any

from lifecoach_agent.contracts.models import TaskProjection


def project_task(raw: dict[str, Any], task_list_id: str) -> TaskProjection:
    status = "completed" if raw.get("status") == "completed" else "needsAction"
    payload: dict[str, Any] = {
        "id": raw.get("id") or "",
        "taskListId": task_list_id,
        "title": raw.get("title") or "(untitled)",
        "status": status,
    }
    if raw.get("due"):
        payload["due"] = raw["due"]
    if raw.get("notes"):
        payload["notes"] = raw["notes"]
    if raw.get("completed"):
        payload["completed"] = raw["completed"]
    return TaskProjection.model_validate(payload)
