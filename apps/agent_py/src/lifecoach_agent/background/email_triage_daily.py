"""Read-only daily inbox triage background workflow.

The workflow deliberately owns a much smaller surface than the interactive
Workspace agent: one bounded Gmail list, one bounded bulk read, and one
structured model call.  It can only create Lifecoach notification/proposal
records; it never invokes a Workspace write API.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol

from lifecoach_agent.background.workflow import (
    BackgroundRetryableError,
    BackgroundRunContext,
    BackgroundRunResult,
)
from lifecoach_agent.contracts.background import (
    BackgroundNotification,
    BackgroundNotificationItem,
    BackgroundProposedAction,
    ProposedActionType,
)
from lifecoach_agent.contracts.models import TriageReport
from lifecoach_agent.workspace_agent.gws_client import CallWorkspaceOk, call_workspace
from lifecoach_agent.workspace_agent.projections import project_gmail_message

GMAIL_SCOPE = "https://mail.google.com/"
MODEL = "gemini-flash-lite-latest"
MAX_MESSAGES = 15
MAX_BODY_CHARS = 12_000


class Eligibility(Protocol):
    async def is_allowed(self, uid: str) -> bool: ...


class Classifier(Protocol):
    async def classify(self, messages: list[dict[str, Any]]) -> TriageReport: ...


@dataclass(frozen=True)
class FirestoreEligibility:
    """Internal rollout gate stored at ``backgroundConfig/global``."""

    firestore: Any

    async def is_allowed(self, uid: str) -> bool:
        raw = await self.firestore.get("backgroundConfig/global")
        values = raw.get("allowlistUids", []) if isinstance(raw, dict) else []
        return uid in values if isinstance(values, list) else False


@dataclass(frozen=True)
class GeminiClassifier:
    client: Any
    model: str = MODEL

    async def classify(self, messages: list[dict[str, Any]]) -> TriageReport:
        from google.genai import types

        prompt = (
            "Classify every email into exactly one of noise, actions, events, or info. "
            "Never invent message IDs or facts. Keep snippets short. Return the requested schema.\n"
            + json.dumps(messages, separators=(",", ":"), ensure_ascii=False)
        )
        response = await self.client.aio.models.generate_content(
            model=self.model,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json", response_schema=TriageReport
            ),
        )
        if response.parsed is not None:
            return TriageReport.model_validate(response.parsed)
        return TriageReport.model_validate_json(response.text or "")


class EmailTriageDailyWorkflow:
    name = "email_triage_daily"
    required_scopes: tuple[str, ...] = (GMAIL_SCOPE,)

    def __init__(self, *, classifier: Classifier) -> None:
        self._classifier = classifier

    async def run(self, ctx: BackgroundRunContext) -> BackgroundRunResult:
        messages = await _read_messages(ctx.workspace_access_token, ctx.run.inputWindowStart)
        report = (
            await self._classifier.classify(messages)
            if messages
            else TriageReport(noise=[], actions=[], events=[], info=[])
        )
        return _to_result(ctx, report)


async def _read_messages(access_token: str, window_start: str) -> list[dict[str, Any]]:
    after = int(datetime.fromisoformat(window_start.replace("Z", "+00:00")).timestamp())
    listed = await call_workspace(
        access_token=access_token,
        service="gmail",
        resource="users.messages",
        method="list",
        params=json.dumps(
            {"userId": "me", "q": f"in:inbox after:{after}", "maxResults": MAX_MESSAGES}
        ),
    )
    if not isinstance(listed, CallWorkspaceOk):
        raise BackgroundRetryableError(f"GMAIL_{listed.code.upper()}")
    body = listed.body if isinstance(listed.body, dict) else {}
    ids = list(
        dict.fromkeys(
            m.get("id") for m in body.get("messages", []) if isinstance(m, dict) and m.get("id")
        )
    )[:MAX_MESSAGES]
    fetched = await asyncio.gather(
        *[
            call_workspace(
                access_token=access_token,
                service="gmail",
                resource="users.messages",
                method="get",
                params=json.dumps({"userId": "me", "id": mid, "format": "full"}),
            )
            for mid in ids
        ]
    )
    projected: list[dict[str, Any]] = []
    for result in fetched:
        if not isinstance(result, CallWorkspaceOk):
            raise BackgroundRetryableError(f"GMAIL_{result.code.upper()}")
        raw = result.body if isinstance(result.body, dict) else {}
        item = project_gmail_message(raw).model_dump(by_alias=True, exclude_none=True)
        if isinstance(item.get("body"), str):
            item["body"] = item["body"][:MAX_BODY_CHARS]
        projected.append(item)
    return projected


def _id(prefix: str, run_id: str, message_id: str = "") -> str:
    digest = hashlib.sha256(f"{run_id}:{message_id}".encode()).hexdigest()[:20]
    return f"{prefix}_{digest}"


def _to_result(ctx: BackgroundRunContext, report: TriageReport) -> BackgroundRunResult:
    notification_id = _id("notification", ctx.run.id)
    rows: list[BackgroundNotificationItem] = []
    actions: list[BackgroundProposedAction] = []
    for bucket in ("noise", "actions", "events", "info"):
        for entry in getattr(report, bucket):
            rows.append(
                BackgroundNotificationItem(
                    messageId=entry.id,
                    threadId=entry.threadId,
                    bucket=bucket,
                    subject=entry.subject,
                    snippet=entry.snippet[:280],
                )
            )
            action_type: ProposedActionType | None = None
            params: dict[str, Any] | None = None
            summary = entry.subject
            permitted = ctx.schedule.permittedActions
            if bucket == "noise" and permitted.archiveNoise == "after_confirmation":
                action_type = "archive_message"
            elif bucket == "actions" and permitted.createTasks == "after_confirmation":
                action_type, summary, params = "create_task", entry.task, {"title": entry.task}
            elif bucket == "events" and permitted.createCalendarEvents == "after_confirmation":
                action_type = "create_calendar_event"
                params = {"summary": entry.subject, "start": entry.proposedStart}
                if entry.proposedEnd:
                    params["end"] = entry.proposedEnd
                if entry.location:
                    params["location"] = entry.location
            if action_type:
                actions.append(
                    BackgroundProposedAction(
                        id=_id("action", ctx.run.id, entry.id),
                        uid=ctx.run.uid,
                        runId=ctx.run.id,
                        notificationId=notification_id,
                        type=action_type,
                        status="proposed",
                        sourceMessageIds=[entry.id],
                        summary=summary,
                        params=params,
                        createdAt=ctx.now_iso,
                    )
                )
    action_ids = [action.id for action in actions]
    count = len(rows)
    notification = BackgroundNotification(
        id=notification_id,
        uid=ctx.run.uid,
        runId=ctx.run.id,
        kind="email_triage_daily",
        status="unread",
        title=f"Inbox digest · {count} message{'s' if count != 1 else ''}",
        summary=f"{len(report.actions)} action, {len(report.events)} event, {len(report.info)} info, and {len(report.noise)} noise item(s).",
        items=rows,
        proposedActions=action_ids,
        createdAt=ctx.now_iso,
    )
    return BackgroundRunResult(
        notification=notification,
        proposed_actions=actions,
        model=MODEL,
        token_cost_estimate=None,
    )
