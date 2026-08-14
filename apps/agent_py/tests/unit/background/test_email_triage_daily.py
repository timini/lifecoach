from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

import pytest

from lifecoach_agent.background.email_triage_daily import (
    EmailTriageDailyWorkflow,
    FirestoreEligibility,
    _to_result,
)
from lifecoach_agent.background.workflow import BackgroundRetryableError, BackgroundRunContext
from lifecoach_agent.contracts.background import BackgroundRun, BackgroundSchedule
from lifecoach_agent.contracts.models import TriageReport
from lifecoach_agent.workspace_agent.gws_client import CallWorkspaceErr, CallWorkspaceOk


class _Classifier:
    model = "gemini-3.5-flash-lite-test"

    def __init__(self, report: dict[str, Any]) -> None:
        self.report = TriageReport.model_validate(report)
        self.calls = 0
        self.reference_time: str | None = None
        self.timezone: str | None = None

    async def classify(
        self,
        messages: list[dict[str, Any]],
        *,
        reference_time: str,
        timezone: str,
    ) -> TriageReport:
        self.calls += 1
        self.reference_time = reference_time
        self.timezone = timezone
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


def _raw_message(mid: str = "m1") -> dict[str, Any]:
    return {
        "id": mid,
        "threadId": f"thread-{mid}",
        "snippet": "Trusted source snippet",
        "payload": {
            "headers": [
                {"name": "From", "value": "Source <source@example.com>"},
                {"name": "Subject", "value": "Trusted subject"},
                {"name": "Date", "value": "Thu, 15 May 2026 07:00:00 +0000"},
            ]
        },
    }


def _patch_workspace(
    monkeypatch: pytest.MonkeyPatch,
    *,
    messages: list[dict[str, Any]] | None = None,
    list_result: CallWorkspaceOk | CallWorkspaceErr | None = None,
    get_result: CallWorkspaceOk | CallWorkspaceErr | None = None,
) -> list[dict[str, Any]]:
    source_messages = messages if messages is not None else [_raw_message()]
    calls: list[dict[str, Any]] = []

    async def workspace(**kwargs: Any) -> Any:
        calls.append(kwargs)
        if kwargs["method"] == "list":
            return list_result or CallWorkspaceOk(
                body={"messages": [{"id": message["id"]} for message in source_messages]}
            )
        if get_result is not None:
            return get_result
        mid = json.loads(kwargs["params"])["id"]
        raw = next(message for message in source_messages if message["id"] == mid)
        return CallWorkspaceOk(body=kwargs["result_projector"](raw))

    monkeypatch.setattr("lifecoach_agent.background.email_triage_daily.call_workspace", workspace)
    return calls


@pytest.mark.asyncio
async def test_builds_digest_and_reviewable_actions(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _patch_workspace(monkeypatch)
    classifier = _Classifier(
        {
            "noise": [],
            "events": [],
            "info": [],
            "actions": [
                {
                    "id": "m1",
                    "threadId": "model-thread",
                    "from": "Model sender",
                    "subject": "Model subject",
                    "receivedAt": "today",
                    "snippet": "Model snippet",
                    "task": "Send report",
                }
            ],
        }
    )
    result = await EmailTriageDailyWorkflow(classifier=classifier).run(_context())
    assert len(calls) == 2
    query = json.loads(calls[0]["params"])["q"]
    assert query == "in:inbox after:1778745600 before:1778832000"
    assert classifier.reference_time == "2026-05-15T08:00:00Z"
    assert classifier.timezone == "UTC"
    assert result.notification is not None
    assert result.notification.items[0].messageId == "m1"
    assert result.notification.items[0].threadId == "thread-m1"
    assert result.notification.items[0].subject == "Trusted subject"
    assert result.notification.items[0].snippet == "Trusted source snippet"
    assert result.notification.proposedActions == [result.proposed_actions[0].id]
    assert result.proposed_actions[0].type == "create_task"
    assert result.proposed_actions[0].status == "proposed"
    assert result.proposed_actions[0].params == {"title": "Send report"}
    assert result.model == classifier.model


@pytest.mark.asyncio
async def test_empty_inbox_skips_classifier_and_model_telemetry(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_workspace(monkeypatch, messages=[])
    classifier = _Classifier({"noise": [], "actions": [], "events": [], "info": []})

    result = await EmailTriageDailyWorkflow(classifier=classifier).run(_context())

    assert classifier.calls == 0
    assert result.model is None
    assert result.notification is not None
    assert result.notification.items == []


@pytest.mark.asyncio
async def test_rejects_classifier_ids_that_do_not_match_source(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_workspace(monkeypatch)
    classifier = _Classifier(
        {
            "noise": [
                {
                    "id": "invented",
                    "from": "A",
                    "subject": "S",
                    "receivedAt": "today",
                    "snippet": "N",
                }
            ],
            "actions": [],
            "events": [],
            "info": [],
        }
    )

    with pytest.raises(ValueError, match="ids do not match"):
        await EmailTriageDailyWorkflow(classifier=classifier).run(_context())


@pytest.mark.asyncio
async def test_classifies_only_transient_gmail_errors_as_retryable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_workspace(
        monkeypatch,
        list_result=CallWorkspaceErr(status="error", code="rate_limited", message="raw"),
    )
    classifier = _Classifier({"noise": [], "actions": [], "events": [], "info": []})
    with pytest.raises(BackgroundRetryableError, match="GMAIL_RATE_LIMITED"):
        await EmailTriageDailyWorkflow(classifier=classifier).run(_context())

    _patch_workspace(
        monkeypatch,
        list_result=CallWorkspaceErr(status="error", code="forbidden", message="raw"),
    )
    with pytest.raises(RuntimeError, match="GMAIL_FORBIDDEN"):
        await EmailTriageDailyWorkflow(classifier=classifier).run(_context())


def test_invalid_calendar_time_is_not_proposed() -> None:
    report = TriageReport.model_validate(
        {
            "noise": [],
            "actions": [],
            "info": [],
            "events": [
                {
                    "id": "m1",
                    "threadId": "t1",
                    "from": "A",
                    "subject": "Meeting",
                    "receivedAt": "today",
                    "snippet": "Tomorrow at 3",
                    "proposedStart": "tomorrow at 3",
                }
            ],
        }
    )

    result = _to_result(_context(), report, model=MODEL_FOR_TEST)

    assert result.notification is not None
    assert result.notification.items[0].bucket == "events"
    assert result.proposed_actions == []


def test_action_id_changes_when_proposal_changes() -> None:
    def result_for(task: str) -> str:
        report = TriageReport.model_validate(
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
                        "task": task,
                    }
                ],
            }
        )
        return _to_result(_context(), report, model=MODEL_FOR_TEST).proposed_actions[0].id

    assert result_for("Send report") != result_for("Review report")


@pytest.mark.asyncio
async def test_firestore_eligibility_fails_closed() -> None:
    @dataclass
    class Snapshot:
        value: dict[str, Any] | None

        @property
        def exists(self) -> bool:
            return self.value is not None

        def data(self) -> dict[str, Any] | None:
            return self.value

    class Firestore:
        value: dict[str, Any] | None = None

        async def get(self, path: str) -> Snapshot:
            assert path == "backgroundConfig/global"
            return Snapshot(self.value)

    firestore = Firestore()
    gate = FirestoreEligibility(firestore)
    assert not await gate.is_allowed("u1")
    firestore.value = {"allowlistUids": ["u1", "u2"]}
    assert await gate.is_allowed("u1")
    assert not await gate.is_allowed("u3")


MODEL_FOR_TEST = "gemini-3.5-flash-lite-test"
