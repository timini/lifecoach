"""Pydantic mirror of `packages/shared-types/src/background.ts` (ADR 0001).

Contracts for the background / scheduled agent-work subsystem. The TS
package stays the source of truth for the web↔agent wire format; this is
the hand-maintained Python port. `tests/unit/test_background_contracts.py`
ports the same valid/invalid cases so any drift fails CI.

OAuth tokens, raw email bodies, addresses, and full snippets must NEVER
appear in these records — only IDs, counts, status, sanitized error
classes, and short client-safe text.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Final, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


def _validate_iso8601(value: str, label: str) -> str:
    """Match Zod's ``z.string().datetime()`` — ISO 8601 with a time
    component (and, like the existing contracts, a timezone via the
    trailing ``Z`` or offset)."""
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as e:
        raise ValueError(f"invalid ISO 8601 {label}: {value}") from e
    if "T" not in value:
        raise ValueError(f"{label} must include time component")
    return value


# --- workflow kinds -------------------------------------------------------

BACKGROUND_WORKFLOW_KINDS: Final[tuple[str, ...]] = (
    "email_triage_daily",
    "email_urgent_scan",
)

BackgroundWorkflowKind = Literal["email_triage_daily", "email_urgent_scan"]


# --- schedule -------------------------------------------------------------

PERMITTED_ACTION_MODES: Final[tuple[str, ...]] = (
    "never",
    "after_confirmation",
    "auto_if_rule_matches",
)

PermittedActionMode = Literal["never", "after_confirmation", "auto_if_rule_matches"]

LOOKBACK_WINDOWS: Final[tuple[str, ...]] = ("12h", "1d", "3d")

LookbackWindow = Literal["12h", "1d", "3d"]

SCHEDULE_LAST_STATUSES: Final[tuple[str, ...]] = ("ok", "skipped", "failed")

ScheduleLastStatus = Literal["ok", "skipped", "failed"]

_LOCAL_TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


class ScheduleCadence(BaseModel):
    """Daily cadence policy. ``localTime`` is ``HH:MM`` 24h in the
    schedule's IANA ``timezone``; ``weekdays`` (0=Sunday … 6=Saturday)
    narrows to specific days — omit for every day."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["daily"]
    localTime: str  # noqa: N815 — wire camelCase preserved for parity
    weekdays: list[int] | None = None

    @field_validator("localTime")
    @classmethod
    def local_time_hhmm(cls, v: str) -> str:
        if not _LOCAL_TIME_RE.match(v):
            raise ValueError(f"localTime must be HH:MM 24h: {v}")
        return v

    @field_validator("weekdays")
    @classmethod
    def weekdays_in_range(cls, v: list[int] | None) -> list[int] | None:
        if v is None:
            return v
        for day in v:
            if day < 0 or day > 6:
                raise ValueError(f"weekday out of range 0..6: {day}")
        return v


class PermittedActions(BaseModel):
    model_config = ConfigDict(extra="forbid")

    archiveNoise: PermittedActionMode  # noqa: N815
    createTasks: PermittedActionMode  # noqa: N815
    createCalendarEvents: PermittedActionMode  # noqa: N815


class NotifyPreferences(BaseModel):
    model_config = ConfigDict(extra="forbid")

    inApp: bool  # noqa: N815
    email: bool
    chatSummaryOnNextOpen: bool  # noqa: N815


class BackgroundSchedule(BaseModel):
    """A user-configured automation. Application state, not model state."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    uid: str = Field(min_length=1)
    kind: BackgroundWorkflowKind
    enabled: bool
    timezone: str = Field(min_length=1)
    cadence: ScheduleCadence
    lookbackWindow: LookbackWindow  # noqa: N815
    consentVersion: str = Field(min_length=1)  # noqa: N815
    permittedActions: PermittedActions  # noqa: N815
    notify: NotifyPreferences
    nextRunAt: str  # noqa: N815
    lastRunAt: str | None = None  # noqa: N815
    lastStatus: ScheduleLastStatus | None = None  # noqa: N815
    createdAt: str  # noqa: N815
    updatedAt: str  # noqa: N815

    @field_validator("nextRunAt", "createdAt", "updatedAt")
    @classmethod
    def required_timestamps(cls, v: str) -> str:
        return _validate_iso8601(v, "timestamp")

    @field_validator("lastRunAt")
    @classmethod
    def optional_timestamp(cls, v: str | None) -> str | None:
        return v if v is None else _validate_iso8601(v, "lastRunAt")


# --- run ------------------------------------------------------------------

BACKGROUND_RUN_STATUSES: Final[tuple[str, ...]] = (
    "queued",
    "running",
    "succeeded",
    "retryable_failed",
    "terminal_failed",
    "skipped",
    "cancelled",
    "superseded",
)

BackgroundRunStatus = Literal[
    "queued",
    "running",
    "succeeded",
    "retryable_failed",
    "terminal_failed",
    "skipped",
    "cancelled",
    "superseded",
]


class BackgroundRun(BaseModel):
    """One execution attempt. ``errorMessage`` is sanitized — only a stable
    class/code, never a raw third-party exception."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    uid: str = Field(min_length=1)
    scheduleId: str = Field(min_length=1)  # noqa: N815
    kind: BackgroundWorkflowKind
    status: BackgroundRunStatus
    idempotencyKey: str = Field(min_length=1)  # noqa: N815
    scheduledFor: str  # noqa: N815
    inputWindowStart: str  # noqa: N815
    inputWindowEnd: str  # noqa: N815
    startedAt: str | None = None  # noqa: N815
    finishedAt: str | None = None  # noqa: N815
    attempt: int = Field(ge=0)
    leaseExpiresAt: str | None = None  # noqa: N815
    outputRef: str | None = Field(default=None, min_length=1)  # noqa: N815
    errorCode: str | None = Field(default=None, min_length=1)  # noqa: N815
    errorMessage: str | None = None  # noqa: N815
    model: str | None = Field(default=None, min_length=1)
    tokenCostEstimate: float | None = Field(default=None, ge=0)  # noqa: N815
    createdAt: str  # noqa: N815

    @field_validator("scheduledFor", "inputWindowStart", "inputWindowEnd", "createdAt")
    @classmethod
    def required_timestamps(cls, v: str) -> str:
        return _validate_iso8601(v, "timestamp")

    @field_validator("startedAt", "finishedAt", "leaseExpiresAt")
    @classmethod
    def optional_timestamps(cls, v: str | None) -> str | None:
        return v if v is None else _validate_iso8601(v, "timestamp")


# --- proposed action ------------------------------------------------------

PROPOSED_ACTION_TYPES: Final[tuple[str, ...]] = (
    "archive_message",
    "create_task",
    "create_calendar_event",
)

ProposedActionType = Literal["archive_message", "create_task", "create_calendar_event"]

PROPOSED_ACTION_STATUSES: Final[tuple[str, ...]] = (
    "proposed",
    "approved",
    "rejected",
    "executed",
    "failed",
)

ProposedActionStatus = Literal["proposed", "approved", "rejected", "executed", "failed"]


class ProposedActionResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ok: bool
    ref: str | None = Field(default=None, min_length=1)
    errorCode: str | None = Field(default=None, min_length=1)  # noqa: N815


class BackgroundProposedAction(BaseModel):
    """A write the run proposes but never performs — it needs foreground
    confirmation before routing to the existing Workspace write tools."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    uid: str = Field(min_length=1)
    runId: str = Field(min_length=1)  # noqa: N815
    notificationId: str | None = Field(default=None, min_length=1)  # noqa: N815
    type: ProposedActionType
    status: ProposedActionStatus
    sourceMessageIds: list[str]  # noqa: N815
    summary: str = Field(min_length=1)
    params: dict[str, Any] | None = None
    result: ProposedActionResult | None = None
    createdAt: str  # noqa: N815

    @field_validator("sourceMessageIds")
    @classmethod
    def source_ids_non_empty(cls, v: list[str]) -> list[str]:
        for mid in v:
            if not mid:
                raise ValueError("sourceMessageIds must be non-empty strings")
        return v

    @field_validator("createdAt")
    @classmethod
    def created_at_iso(cls, v: str) -> str:
        return _validate_iso8601(v, "createdAt")


# --- notification / digest ------------------------------------------------

NOTIFICATION_STATUSES: Final[tuple[str, ...]] = (
    "unread",
    "read",
    "dismissed",
    "acted_on",
)

NotificationStatus = Literal["unread", "read", "dismissed", "acted_on"]

NotificationItemBucket = Literal["noise", "actions", "events", "info"]


class BackgroundNotificationItem(BaseModel):
    """One row in a digest — stable Workspace IDs + a short snippet only,
    never the full body/address."""

    model_config = ConfigDict(extra="forbid")

    messageId: str = Field(min_length=1)  # noqa: N815
    threadId: str | None = Field(default=None, min_length=1)  # noqa: N815
    bucket: NotificationItemBucket
    subject: str = Field(min_length=1)
    snippet: str = Field(min_length=1)


class BackgroundNotification(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    uid: str = Field(min_length=1)
    runId: str = Field(min_length=1)  # noqa: N815
    kind: BackgroundWorkflowKind
    status: NotificationStatus
    title: str = Field(min_length=1)
    summary: str = Field(min_length=1)
    items: list[BackgroundNotificationItem]
    proposedActions: list[str]  # noqa: N815
    createdAt: str  # noqa: N815
    expiresAt: str | None = None  # noqa: N815

    @field_validator("proposedActions")
    @classmethod
    def action_ids_non_empty(cls, v: list[str]) -> list[str]:
        for aid in v:
            if not aid:
                raise ValueError("proposedActions must be non-empty strings")
        return v

    @field_validator("createdAt")
    @classmethod
    def created_at_iso(cls, v: str) -> str:
        return _validate_iso8601(v, "createdAt")

    @field_validator("expiresAt")
    @classmethod
    def expires_at_iso(cls, v: str | None) -> str | None:
        return v if v is None else _validate_iso8601(v, "expiresAt")


# --- task-id sanitization -------------------------------------------------

_INVALID_TASK_ID_CHARS = re.compile(r"[^A-Za-z0-9_-]")


def sanitize_task_id(value: str) -> str:
    """Mirror of ``sanitizeTaskId`` in background.ts. Cloud Tasks task IDs
    allow only letters, numbers, hyphens, and underscores (ADR §4); replace
    every other character with ``_``. Pure character replacement — callers
    hash long/sensitive identifiers before composing the id."""
    return _INVALID_TASK_ID_CHARS.sub("_", value)
