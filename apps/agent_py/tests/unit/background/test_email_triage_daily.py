from __future__ import annotations

from typing import Any

import pytest

from lifecoach_agent.background.email_triage_daily import (
    EmailTriageDailyWorkflow,
    FirestoreEligibility,
)
from lifecoach_agent.background.workflow import BackgroundRunContext
from lifecoach_agent.contracts.background import BackgroundRun, BackgroundSchedule
from lifecoach_agent.contracts.models import TriageReport


class _Classifier:
    def __init__(self, report: dict[str, Any]) -> None:
        self.report = TriageReport.model_validate(report)
        self.calls = 0

    async def classify(self, messages: list[dict[str, Any]]) -> TriageReport:
        self.calls += 1
        return self.report


def _context() -> BackgroundRunContext:
    return BackgroundRunContext(
        run=BackgroundRun.model_validate(
            {
                "id": "r1",
                "uid": "u1",
                "scheduleId": "s1",
                "kind": "email_triage_daily",
                "status": "running",
                "idempotencyKey": "key",
                "scheduledFor": "2026-05-15T08:00:00Z",
                "inputWindowStart": "2026-05-14T08:00:00Z",
                "inputWindowEnd": "2026-05-15T08:00:00Z",
                "attempt": 1,
                "createdAt": "2026-05-15T08:00:00Z",
            }
        ),
        schedule=BackgroundSchedule.model_validate(
            {
                "id": "s1",
                "uid": "u1",
                "kind": "email_triage_daily",
                "enabled": True,
                "timezone": "UTC",
                "cadence": {"type": "daily", "localTime": "08:00"},
                "lookbackWindow": "1d",
                "consentVersion": "v1",
                "permittedActions": {
                    "archiveNoise": "after_confirmation",
                    "createTasks": "after_confirmation",
                    "createCalendarEvents": "after_confirmation",
                },
                "notify": {"inApp": True, "email": False, "chatSummaryOnNextOpen": True},
                "nextRunAt": "2026-05-16T08:00:00Z",
                "createdAt": "2026-05-01T00:00:00Z",
                "updatedAt": "2026-05-01T00:00:00Z",
            }
        ),
        workspace_access_token="secret",
        now_iso="2026-05-15T08:01:00Z",
    )


@pytest.mark.asyncio
async def test_builds_digest_and_reviewable_actions(monkeypatch: pytest.MonkeyPatch) -> None:
    from lifecoach_agent.workspace_agent.gws_client import CallWorkspaceOk

    calls = 0

    async def workspace(**kwargs: Any) -> Any:
        nonlocal calls
        calls += 1
        if kwargs["method"] == "list":
            return CallWorkspaceOk(body={"messages": [{"id": "m1"}]})
        return CallWorkspaceOk(
            body={
                "id": "m1",
                "threadId": "t1",
                "snippet": "Please send it",
                "payload": {
                    "headers": [
                        {"name": "From", "value": "A <a@example.com>"},
                        {"name": "Subject", "value": "Report"},
                        {"name": "Date", "value": "Thu, 15 May 2026 07:00:00 +0000"},
                    ]
                },
            }
        )

    monkeypatch.setattr("lifecoach_agent.background.email_triage_daily.call_workspace", workspace)
    classifier = _Classifier(
        {
            "noise": [],
            "events": [],
            "info": [],
            "actions": [
                {
                    "id": "m1",
                    "threadId": "t1",
                    "from": "A",
                    "subject": "Report",
                    "receivedAt": "today",
                    "snippet": "Please send it",
                    "task": "Send report",
                }
            ],
        }
    )
    result = await EmailTriageDailyWorkflow(classifier=classifier).run(_context())
    assert calls == 2
    assert result.notification is not None
    assert result.notification.items[0].messageId == "m1"
    assert result.notification.proposedActions == [result.proposed_actions[0].id]
    assert result.proposed_actions[0].type == "create_task"
    assert result.proposed_actions[0].status == "proposed"
    assert result.proposed_actions[0].params == {"title": "Send report"}


@pytest.mark.asyncio
async def test_firestore_eligibility_fails_closed() -> None:
    class Firestore:
        value: dict[str, Any] | None = None

        async def get(self, path: str) -> dict[str, Any] | None:
            assert path == "backgroundConfig/global"
            return self.value

    firestore = Firestore()
    gate = FirestoreEligibility(firestore)
    assert not await gate.is_allowed("u1")
    firestore.value = {"allowlistUids": ["u1", "u2"]}
    assert await gate.is_allowed("u1")
    assert not await gate.is_allowed("u3")
