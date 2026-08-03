from __future__ import annotations

from typing import Any

import pytest

from lifecoach_agent.background.email_triage import (
    EMAIL_TRIAGE_MODEL,
    MAX_MESSAGES,
    EmailTriageDailyWorkflow,
)
from lifecoach_agent.background.workflow import BackgroundRetryableError, BackgroundRunContext
from lifecoach_agent.contracts.background import BackgroundRun, BackgroundSchedule
from lifecoach_agent.contracts.models import TriageReport


def _ctx() -> BackgroundRunContext:
    schedule = BackgroundSchedule.model_validate(
        {
            "id": "schedule-1",
            "uid": "uid-1",
            "kind": "email_triage_daily",
            "enabled": True,
            "timezone": "UTC",
            "cadence": {"type": "daily", "localTime": "08:00"},
            "lookbackWindow": "1d",
            "consentVersion": "v1",
            "permittedActions": {
                "archiveNoise": "after_confirmation",
                "createTasks": "after_confirmation",
                "createCalendarEvents": "never",
            },
            "notify": {"inApp": True, "email": False, "chatSummaryOnNextOpen": True},
            "nextRunAt": "2026-08-04T08:00:00Z",
            "createdAt": "2026-08-01T08:00:00Z",
            "updatedAt": "2026-08-01T08:00:00Z",
        }
    )
    run = BackgroundRun.model_validate(
        {
            "id": "run-1",
            "uid": "uid-1",
            "scheduleId": "schedule-1",
            "kind": "email_triage_daily",
            "status": "running",
            "idempotencyKey": "key",
            "scheduledFor": "2026-08-03T08:00:00Z",
            "inputWindowStart": "2026-08-02T08:00:00Z",
            "inputWindowEnd": "2026-08-03T08:00:00Z",
            "attempt": 1,
            "createdAt": "2026-08-03T08:00:00Z",
        }
    )
    return BackgroundRunContext(
        run=run,
        schedule=schedule,
        workspace_access_token="secret-token",
        now_iso="2026-08-03T08:01:00Z",
    )


class Allowlist:
    def __init__(self, allowed: bool = True) -> None:
        self.allowed = allowed

    async def contains(self, uid: str) -> bool:
        return self.allowed


class Reader:
    def __init__(self) -> None:
        self.args: dict[str, Any] = {}

    async def read(self, **kwargs: Any) -> list[dict[str, Any]]:
        self.args = kwargs
        return [{"id": "m1", "body": "body stays ephemeral"}]


class Classifier:
    async def classify(self, messages: Any) -> TriageReport:
        base = {
            "threadId": "t1",
            "from": "sender",
            "subject": "Newsletter",
            "receivedAt": "today",
            "snippet": "Weekly news",
        }
        return TriageReport.model_validate(
            {
                "noise": [{"id": "m1", **base}],
                "actions": [{"id": "m2", **base, "subject": "Do this", "task": "Reply today"}],
                "events": [
                    {"id": "m3", **base, "subject": "Meet", "proposedStart": "2026-08-04T10:00:00Z"}
                ],
                "info": [],
            }
        )


@pytest.mark.asyncio
async def test_builds_digest_and_only_permitted_proposals() -> None:
    reader = Reader()
    workflow = EmailTriageDailyWorkflow(
        reader=reader, classifier=Classifier(), allowlist=Allowlist()
    )
    result = await workflow.run(_ctx())
    assert reader.args == {"access_token": "secret-token", "since": "1d", "limit": MAX_MESSAGES}
    assert result.model == EMAIL_TRIAGE_MODEL
    assert result.notification is not None
    assert [item.bucket for item in result.notification.items] == ["noise", "actions", "events"]
    assert [action.type for action in result.proposed_actions] == ["archive_message", "create_task"]
    assert result.notification.proposedActions == [a.id for a in result.proposed_actions]


@pytest.mark.asyncio
async def test_empty_inbox_skips_classifier_and_returns_empty_digest() -> None:
    reader = Reader()

    async def empty(**kwargs: Any) -> list[dict[str, Any]]:
        return []

    reader.read = empty  # type: ignore[method-assign]
    workflow = EmailTriageDailyWorkflow(
        reader=reader, classifier=Classifier(), allowlist=Allowlist()
    )
    result = await workflow.run(_ctx())
    assert result.notification is not None
    assert result.notification.items == []
    assert result.notification.summary == "0 noise, 0 actions, 0 events, 0 info"


@pytest.mark.asyncio
async def test_rejects_uid_outside_internal_allowlist_before_gmail() -> None:
    reader = Reader()
    workflow = EmailTriageDailyWorkflow(
        reader=reader, classifier=Classifier(), allowlist=Allowlist(False)
    )
    with pytest.raises(RuntimeError):
        await workflow.run(_ctx())
    assert reader.args == {}


@pytest.mark.asyncio
async def test_sanitizes_upstream_failure_as_retryable() -> None:
    reader = Reader()

    async def fail(**kwargs: Any) -> list[dict[str, Any]]:
        raise OSError("sensitive")

    reader.read = fail  # type: ignore[method-assign]
    workflow = EmailTriageDailyWorkflow(
        reader=reader, classifier=Classifier(), allowlist=Allowlist()
    )
    with pytest.raises(BackgroundRetryableError, match="EMAIL_TRIAGE_UPSTREAM_FAILED"):
        await workflow.run(_ctx())
