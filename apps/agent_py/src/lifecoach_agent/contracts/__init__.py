"""Cross-language contracts.

These Pydantic models mirror the Zod schemas in
`packages/shared-types/src/`. The TS package remains the source of truth
for the web↔agent wire format; this module is a hand-maintained Python
port. Any change in `packages/shared-types/` requires the matching change
here, and the parity tests in `tests/unit/test_contracts.py` enforce
that the validation rules (required fields, enum members, length bounds)
stay aligned.
"""

from lifecoach_agent.contracts.models import (
    AUTH_MODES,
    AUTH_USER_TOOL_NAME,
    CHOICE_TOOL_NAMES,
    GOAL_STATUSES,
    PRACTICE_METADATA,
    WORKSPACE_SCOPES,
    AuthMode,
    AuthUserArgs,
    CalendarListEntryProjection,
    ChoiceQuestion,
    ChoiceToolName,
    EventProjection,
    EventTime,
    GoalStatus,
    GoalUpdate,
    MessageProjection,
    PracticeMetadata,
    TaskProjection,
    TriageAction,
    TriageEvent,
    TriageInfo,
    TriageNoise,
    TriageReport,
    UserProfile,
    WorkspaceScope,
    WorkspaceStatus,
    empty_user_profile,
    practice_enabled_path,
)

__all__ = [
    "AUTH_MODES",
    "AUTH_USER_TOOL_NAME",
    "CHOICE_TOOL_NAMES",
    "GOAL_STATUSES",
    "PRACTICE_METADATA",
    "WORKSPACE_SCOPES",
    "AuthMode",
    "AuthUserArgs",
    "CalendarListEntryProjection",
    "ChoiceQuestion",
    "ChoiceToolName",
    "EventProjection",
    "EventTime",
    "GoalStatus",
    "GoalUpdate",
    "MessageProjection",
    "PracticeMetadata",
    "TaskProjection",
    "TriageAction",
    "TriageEvent",
    "TriageInfo",
    "TriageNoise",
    "TriageReport",
    "UserProfile",
    "WorkspaceScope",
    "WorkspaceStatus",
    "empty_user_profile",
    "practice_enabled_path",
]
