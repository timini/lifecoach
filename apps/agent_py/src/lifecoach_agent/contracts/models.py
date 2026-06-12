"""Pydantic mirror of `packages/shared-types/src/`.

Each schema below is one-for-one with its Zod counterpart. The
`tests/unit/test_contracts.py` file ports the same valid/invalid cases
verbatim so any drift fails CI.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Final, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

# Liberal email regex matching what Zod's `z.string().email()` accepts —
# user@host.tld with no local-part exotica. We avoid `pydantic[email]` to
# keep the dependency tree lean.
_EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$")

# --- meta -----------------------------------------------------------------

PACKAGE_NAME: Final[str] = "@lifecoach/shared-types"


# --- authUser -------------------------------------------------------------

AUTH_MODES: Final[tuple[str, ...]] = ("google", "email")
AUTH_USER_TOOL_NAME: Final[str] = "auth_user"

AuthMode = Literal["google", "email"]


class AuthUserArgs(BaseModel):
    """Args for the `auth_user` tool — invites the user to upgrade from
    anonymous sign-in to email or Google."""

    model_config = ConfigDict(extra="forbid")

    mode: AuthMode
    # Only required for mode='email'; if omitted, the frontend prompts.
    email: str | None = None

    @field_validator("email")
    @classmethod
    def email_format(cls, v: str | None) -> str | None:
        if v is None:
            return v
        if not _EMAIL_RE.match(v):
            raise ValueError(f"invalid email: {v}")
        return v


# --- choiceQuestion -------------------------------------------------------

CHOICE_TOOL_NAMES: Final[dict[str, str]] = {
    "single": "ask_single_choice_question",
    "multiple": "ask_multiple_choice_question",
}

ChoiceToolName = Literal["ask_single_choice_question", "ask_multiple_choice_question"]


class ChoiceQuestion(BaseModel):
    """Inline choice-question payload, used by both the agent tool args
    and the SSE event sent to the web renderer."""

    model_config = ConfigDict(extra="forbid")

    question: str = Field(min_length=1)
    options: list[str] = Field(min_length=2, max_length=8)

    @field_validator("options")
    @classmethod
    def options_non_empty(cls, v: list[str]) -> list[str]:
        for opt in v:
            if not opt:
                raise ValueError("options must be non-empty strings")
        return v


# --- goalUpdate -----------------------------------------------------------

GOAL_STATUSES: Final[tuple[str, ...]] = (
    "started",
    "progress",
    "completed",
    "paused",
    "abandoned",
)

GoalStatus = Literal["started", "progress", "completed", "paused", "abandoned"]


class GoalUpdate(BaseModel):
    """One entry in users/{uid}/goal_updates.json — append-only history.
    The last 20 entries are injected into the system prompt every turn."""

    model_config = ConfigDict(extra="forbid")

    timestamp: str
    goal: str = Field(min_length=1)
    status: GoalStatus
    note: str | None = None

    @field_validator("timestamp")
    @classmethod
    def timestamp_is_iso8601(cls, v: str) -> str:
        # Match Zod's `z.string().datetime()` — strict ISO 8601 with timezone.
        # `datetime.fromisoformat` in 3.12 accepts the trailing Z form.
        try:
            datetime.fromisoformat(v.replace("Z", "+00:00"))
        except ValueError as e:
            raise ValueError(f"invalid ISO 8601 timestamp: {v}") from e
        if "T" not in v:
            raise ValueError("timestamp must include time component")
        return v


# --- userProfile ----------------------------------------------------------
#
# Schema-free by design (see memory/feedback_yaml_schema_free.md). The
# UserProfile is just a dict of arbitrary keys; the coach invents whatever
# nesting the conversation surfaces. Any closed schema would re-introduce
# the constraint we deliberately removed.

UserProfile = dict[str, Any]


def empty_user_profile() -> UserProfile:
    """Starter template for a brand-new user. Mirrors `emptyUserProfile()`
    in `packages/shared-types/src/userProfile.ts` exactly."""

    return {
        "name": None,
        "age": None,
        "location": {"address": None},
        "family": {
            "relationship_status": None,
            "partner_name": None,
            "children": None,
            "living_situation": None,
        },
        "occupation": {
            "title": None,
            "industry": None,
            "work_style": None,
            "satisfaction": None,
        },
        "health": {
            "exercise_habits": None,
            "sleep_quality": None,
        },
        "personality": {
            "strengths": None,
            "challenges": None,
            "values": None,
        },
        "goals": {
            "short_term": [],
            "medium_term": [],
            "long_term": [],
            "currently_working_on": None,
        },
        "preferences": {
            "communication_style": None,
            "coaching_focus": None,
            "session_preference": None,
        },
    }


# --- workspace ------------------------------------------------------------

WORKSPACE_SCOPES: Final[tuple[str, ...]] = (
    "https://mail.google.com/",
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/tasks",
)

WorkspaceScope = Literal[
    "https://mail.google.com/",
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/tasks",
]


class WorkspaceStatus(BaseModel):
    """GET /workspace/status response — never includes any token values."""

    model_config = ConfigDict(extra="forbid")

    connected: bool
    scopes: list[str]
    grantedAt: str | None  # noqa: N815 — wire field name (camelCase) preserved for parity

    @field_validator("grantedAt")
    @classmethod
    def granted_at_iso8601_or_null(cls, v: str | None) -> str | None:
        if v is None:
            return v
        try:
            datetime.fromisoformat(v.replace("Z", "+00:00"))
        except ValueError as e:
            raise ValueError(f"invalid ISO 8601 grantedAt: {v}") from e
        return v


# --- practices ------------------------------------------------------------


class PracticeMetadata(BaseModel):
    """Practice metadata shared between agent and web. Behaviour stays in
    the agent (one Practice impl per id under `lifecoach_agent.practices`)."""

    model_config = ConfigDict(extra="forbid")

    id: str
    label: str
    description: str


PRACTICE_METADATA: Final[tuple[PracticeMetadata, ...]] = (
    PracticeMetadata(
        id="evening_gratitude",
        label="Evening gratitude",
        description=(
            "Each evening, the coach gently invites one thing you’re grateful for and saves it."
        ),
    ),
    PracticeMetadata(
        id="journaling",
        label="Journaling",
        description=(
            "When something meaningful comes up, the coach offers to capture it as a journal entry."
        ),
    ),
    PracticeMetadata(
        id="day_planning",
        label="Plan the day",
        description=(
            "After the morning check-in, the coach helps you sort 1–3 priorities "
            "— and pulls inbox + calendar signal when Workspace is connected."
        ),
    ),
)


def practice_enabled_path(practice_id: str) -> str:
    """Profile path for the per-practice on/off flag.

    e.g. `practices.day_planning.enabled`. Mirrors `practiceEnabledPath()`.
    """
    return f"practices.{practice_id}.enabled"


# --- workspace projections -----------------------------------------------
#
# Shared shapes for the workspace sub-agent (Gmail / Calendar / Tasks).
# The sub-agent's read tools project raw Google API responses into these
# shapes before returning to the LLM — base64 bodies decoded, header
# bloat dropped, irrelevant fields stripped. Mirrors
# `packages/shared-types/src/workspaceProjections.ts`.


class MessageProjection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    threadId: str  # noqa: N815 — wire camelCase preserved for parity
    from_: str = Field(alias="from")
    subject: str
    date: str
    snippet: str
    body: str
    truncated: bool
    headers: dict[str, str] | None = None


class CalendarListEntryProjection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    summary: str
    primary: bool = False
    accessRole: str  # noqa: N815 — wire camelCase preserved for parity
    timeZone: str  # noqa: N815
    description: str | None = None


class EventTime(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dateTime: str | None = None  # noqa: N815
    date: str | None = None
    timeZone: str | None = None  # noqa: N815


class EventProjection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    calendarId: str | None = None  # noqa: N815
    summary: str
    start: EventTime
    end: EventTime
    location: str | None = None
    attendees: list[str] | None = None
    link: str | None = None
    status: str | None = None
    description: str | None = None


class TaskProjection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    taskListId: str  # noqa: N815
    title: str
    due: str | None = None
    status: Literal["needsAction", "completed"]
    notes: str | None = None
    completed: str | None = None


# --- triage report -------------------------------------------------------


# Every triage item carries per-message context (issue #141): the parent
# coach renders `receivedAt` + `snippet` verbatim in the archive / event /
# task confirmation prompt, so the user can decide without opening Gmail.
# These two fields are min_length=1 to match the Zod `.min(1)` in
# packages/shared-types/src/triageReport.ts — a blank context would defeat
# the prompt requirement and drift from the TS contract.


class TriageNoise(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    threadId: str | None = Field(default=None, min_length=1)  # noqa: N815
    from_: str = Field(alias="from", min_length=1)
    subject: str = Field(min_length=1)
    receivedAt: str = Field(min_length=1)  # noqa: N815
    snippet: str = Field(min_length=1)


class TriageAction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    threadId: str | None = Field(default=None, min_length=1)  # noqa: N815
    from_: str = Field(alias="from", min_length=1)
    subject: str = Field(min_length=1)
    receivedAt: str = Field(min_length=1)  # noqa: N815
    snippet: str = Field(min_length=1)
    task: str = Field(min_length=1)


class TriageEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    threadId: str | None = Field(default=None, min_length=1)  # noqa: N815
    from_: str = Field(alias="from", min_length=1)
    subject: str = Field(min_length=1)
    receivedAt: str = Field(min_length=1)  # noqa: N815
    snippet: str = Field(min_length=1)
    proposedStart: str = Field(min_length=1)  # noqa: N815
    proposedEnd: str | None = Field(default=None, min_length=1)  # noqa: N815
    location: str | None = Field(default=None, min_length=1)


class TriageInfo(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    threadId: str | None = Field(default=None, min_length=1)  # noqa: N815
    from_: str = Field(alias="from", min_length=1)
    subject: str = Field(min_length=1)
    receivedAt: str = Field(min_length=1)  # noqa: N815
    snippet: str = Field(min_length=1)
    note: str = Field(min_length=1)


class TriageReport(BaseModel):
    model_config = ConfigDict(extra="forbid")

    noise: list[TriageNoise]
    actions: list[TriageAction]
    events: list[TriageEvent]
    info: list[TriageInfo]


# --- Notion sub-agent -----------------------------------------------------

NotionStatus = Literal["To Do", "In Progress", "Waiting", "Done"]
NotionPriority = Literal["Urgent", "High", "Medium", "Low"]


class NotionTaskProjection(BaseModel):
    """Flat shape projected from a raw Notion page. The raw page carries
    `properties.{Task,Status,Priority,Project,Due Date,Notes,Parent item}`
    wrapped in Notion's wire format — projection strips it to scalars the
    LLM (and the tree builder) can reason about."""

    model_config = ConfigDict(extra="forbid")

    id: str
    title: str
    status: NotionStatus
    priority: NotionPriority | None = None
    project: str | None = None
    due: str | None = None
    notes: str | None = None
    parentId: str | None = None  # noqa: N815 — Parent item relation target
    url: str
    createdTime: str  # noqa: N815
    lastEditedTime: str  # noqa: N815


class NotionTaskNode(BaseModel):
    """One node in the tree returned by `notion_review_tasks`. Children
    are Parent-item-related sub-tasks."""

    model_config = ConfigDict(extra="forbid")

    task: NotionTaskProjection
    children: list[NotionTaskNode] = Field(default_factory=list)


class NotionTaskTree(BaseModel):
    """Root of the tree the `notion_review_tasks` AgentTool returns.

    `projects` is a dict keyed by Project select value; orphan tasks
    (no Project set) live under the synthetic key '(no project)'. The
    sub-agent emits this as a minified JSON blob in a
    <NOTION_REVIEW>…</NOTION_REVIEW> marker which the wrapper parses."""

    model_config = ConfigDict(extra="forbid")

    generatedAt: str  # noqa: N815
    projects: dict[str, list[NotionTaskNode]]
    totalOpen: int  # noqa: N815 — count of non-Done tasks across the tree


# --- Capability picker (chat-rendered UI element) -------------------------

CapabilityId = Literal["workspace", "notion", "career_coaching"]
CapabilityStatus = Literal["available", "connected", "coming_soon"]
CapabilityCta = Literal["connect_workspace", "connect_notion"]


class CapabilityTilePayload(BaseModel):
    """One tile in the capability picker. Three tiles ship in v1: Personal
    assistant (workspace), Task management (notion), Career coaching
    (placeholder). The chat-stream organism renders these as a horizontal
    stack with images + text + per-status CTA."""

    model_config = ConfigDict(extra="forbid")

    id: CapabilityId
    title: str  # User-facing — coaching language, not engineering jargon.
    body: str  # One-line value-prop.
    iconKey: str  # noqa: N815 — "workspace" | "notion" | "career"
    status: CapabilityStatus
    cta: CapabilityCta | None = None  # None for status=coming_soon.


class ShowCapabilitiesResponse(BaseModel):
    """Tool response surfaced over SSE as the capability picker."""

    model_config = ConfigDict(extra="forbid")

    status: Literal["shown"] = "shown"
    capabilities: list[CapabilityTilePayload]
