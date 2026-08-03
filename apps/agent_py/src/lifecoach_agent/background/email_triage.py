"""Read-only scheduled inbox triage (ADR 0001 rollout step 6).

The workflow deliberately depends on two narrow, injectable ports.  Gmail
projection and Gemini classification can therefore be faked in unit tests and,
more importantly, the workflow itself can never acquire a Workspace write
client.  Only small digest projections are returned to the runner; message
bodies remain in memory for the duration of classification.
"""

from __future__ import annotations

import hashlib
import json
from asyncio import to_thread
from collections.abc import Sequence
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
)
from lifecoach_agent.contracts.models import TriageReport
from lifecoach_agent.storage.background_firestore import BackgroundFirestore
from lifecoach_agent.workspace_agent.projections import project_gmail_message

EMAIL_TRIAGE_MODEL = "gemini-3.6-flash-lite-preview"
GMAIL_SCOPE = "https://mail.google.com/"
MAX_MESSAGES = 15
MAX_DIGEST_SNIPPET = 240


class InboxReader(Protocol):
    async def read(
        self, *, access_token: str, since: str, limit: int
    ) -> Sequence[dict[str, Any]]: ...


class InboxClassifier(Protocol):
    async def classify(self, messages: Sequence[dict[str, Any]]) -> TriageReport: ...


class BackgroundAllowlist(Protocol):
    async def contains(self, uid: str) -> bool: ...


class FirestoreBackgroundAllowlist:
    """Reads the rollout gate from ``backgroundConfig/global`` each run."""

    def __init__(self, firestore: BackgroundFirestore) -> None:
        self._firestore = firestore

    async def contains(self, uid: str) -> bool:
        snapshot = await self._firestore.get("backgroundConfig/global")
        data = snapshot.data() if snapshot.exists else None
        values = data.get("allowlistUids", []) if isinstance(data, dict) else []
        return isinstance(values, list) and uid in values


class GmailInboxReader:
    """Bounded Gmail reader. It only builds the read methods used here."""

    async def read(self, *, access_token: str, since: str, limit: int) -> Sequence[dict[str, Any]]:
        def fetch() -> list[dict[str, Any]]:
            from google.oauth2.credentials import Credentials
            from googleapiclient.discovery import build

            service = build(
                "gmail",
                "v1",
                credentials=Credentials(token=access_token),
                cache_discovery=False,
            )
            listed = (
                service.users()
                .messages()
                .list(userId="me", q=f"in:inbox newer_than:{since}", maxResults=limit)
                .execute()
            )
            ids = list(dict.fromkeys(row.get("id") for row in listed.get("messages", [])))
            projected: list[dict[str, Any]] = []
            for message_id in ids[:limit]:
                if not message_id:
                    continue
                raw = (
                    service.users()
                    .messages()
                    .get(userId="me", id=message_id, format="full")
                    .execute()
                )
                projected.append(
                    project_gmail_message(raw).model_dump(by_alias=True, exclude_none=True)
                )
            return projected

        return await to_thread(fetch)


class GeminiInboxClassifier:
    """One bounded structured-output call using Gemini 3.6 Flash Lite."""

    def __init__(self, client: Any, *, model: str = EMAIL_TRIAGE_MODEL) -> None:
        self._client = client
        self._model = model

    async def classify(self, messages: Sequence[dict[str, Any]]) -> TriageReport:
        response = await self._client.aio.models.generate_content(
            model=self._model,
            contents=json.dumps(list(messages), separators=(",", ":")),
            config={
                "system_instruction": (
                    "Classify every email exactly once into noise, actions, events, or info. "
                    "Copy its id/threadId/from/subject/date as receivedAt/snippet. Add task, "
                    "proposedStart/proposedEnd/location, or note for the applicable bucket."
                ),
                "response_mime_type": "application/json",
                "response_schema": TriageReport,
                "temperature": 0.1,
                "max_output_tokens": 4096,
            },
        )
        parsed = getattr(response, "parsed", None)
        if isinstance(parsed, TriageReport):
            return parsed
        text = getattr(response, "text", None)
        if not isinstance(text, str):
            raise ValueError("Gemini returned no triage report")
        return TriageReport.model_validate_json(text)


def _stable_id(prefix: str, run_id: str, *parts: str) -> str:
    digest = hashlib.sha256(":".join((run_id, *parts)).encode()).hexdigest()[:16]
    return f"{prefix}-{digest}"


def _short(value: str, fallback: str) -> str:
    text = " ".join(value.split()).strip() or fallback
    return text[:MAX_DIGEST_SNIPPET]


class EmailTriageDailyWorkflow:
    """Fetch, classify, and propose actions without mutating Gmail."""

    name = "email_triage_daily"
    required_scopes = (GMAIL_SCOPE,)

    def __init__(
        self, *, reader: InboxReader, classifier: InboxClassifier, allowlist: BackgroundAllowlist
    ) -> None:
        self._reader = reader
        self._classifier = classifier
        self._allowlist = allowlist

    async def run(self, ctx: BackgroundRunContext) -> BackgroundRunResult:
        if not await self._allowlist.contains(ctx.run.uid):
            raise RuntimeError("background user is not allowlisted")

        try:
            messages = await self._reader.read(
                access_token=ctx.workspace_access_token,
                since=ctx.schedule.lookbackWindow,
                limit=MAX_MESSAGES,
            )
            report = (
                await self._classifier.classify(messages)
                if messages
                else TriageReport(noise=[], actions=[], events=[], info=[])
            )
        except BackgroundRetryableError:
            raise
        except Exception as exc:
            raise BackgroundRetryableError("EMAIL_TRIAGE_UPSTREAM_FAILED") from exc

        notification_id = _stable_id("notification", ctx.run.id)
        actions: list[BackgroundProposedAction] = []
        items: list[BackgroundNotificationItem] = []

        buckets = (
            ("noise", report.noise),
            ("actions", report.actions),
            ("events", report.events),
            ("info", report.info),
        )
        for bucket, entries in buckets:
            for entry in entries:
                items.append(
                    BackgroundNotificationItem(
                        messageId=entry.id,
                        threadId=entry.threadId,
                        bucket=bucket,
                        subject=_short(entry.subject, "(no subject)"),
                        snippet=_short(entry.snippet, "No preview available"),
                    )
                )

        permitted = ctx.schedule.permittedActions
        if permitted.archiveNoise == "after_confirmation":
            for entry in report.noise:
                actions.append(
                    self._action(
                        ctx, notification_id, "archive_message", entry.id, entry.subject, None
                    )
                )
        if permitted.createTasks == "after_confirmation":
            for entry in report.actions:
                actions.append(
                    self._action(
                        ctx,
                        notification_id,
                        "create_task",
                        entry.id,
                        entry.task,
                        {"title": entry.task},
                    )
                )
        if permitted.createCalendarEvents == "after_confirmation":
            for entry in report.events:
                params = {"summary": entry.subject, "start": entry.proposedStart}
                if entry.proposedEnd:
                    params["end"] = entry.proposedEnd
                if entry.location:
                    params["location"] = entry.location
                actions.append(
                    self._action(
                        ctx,
                        notification_id,
                        "create_calendar_event",
                        entry.id,
                        entry.subject,
                        params,
                    )
                )

        counts = {bucket: len(entries) for bucket, entries in buckets}
        summary = ", ".join(f"{count} {bucket}" for bucket, count in counts.items())
        notification = BackgroundNotification(
            id=notification_id,
            uid=ctx.run.uid,
            runId=ctx.run.id,
            kind=self.name,
            status="unread",
            title="Your inbox triage is ready",
            summary=summary,
            items=items,
            proposedActions=[action.id for action in actions],
            createdAt=ctx.now_iso,
        )
        return BackgroundRunResult(
            notification=notification, proposed_actions=actions, model=EMAIL_TRIAGE_MODEL
        )

    @staticmethod
    def _action(
        ctx: BackgroundRunContext,
        notification_id: str,
        kind: str,
        message_id: str,
        summary: str,
        params: dict[str, Any] | None,
    ) -> BackgroundProposedAction:
        return BackgroundProposedAction(
            id=_stable_id("action", ctx.run.id, kind, message_id),
            uid=ctx.run.uid,
            runId=ctx.run.id,
            notificationId=notification_id,
            type=kind,
            status="proposed",
            sourceMessageIds=[message_id],
            summary=_short(summary, "Review message"),
            params=params,
            createdAt=ctx.now_iso,
        )
