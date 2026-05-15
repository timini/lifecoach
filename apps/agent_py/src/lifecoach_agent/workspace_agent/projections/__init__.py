"""Pure projection helpers for the workspace sub-agent.

The sub-agent's read tools pipe raw Google API responses through these
helpers before returning to the LLM — base64 bodies decoded, header
bloat dropped, irrelevant fields stripped.
"""

from lifecoach_agent.workspace_agent.projections.calendar_event import (
    project_calendar_event,
)
from lifecoach_agent.workspace_agent.projections.calendar_list import (
    project_calendar_list_entry,
)
from lifecoach_agent.workspace_agent.projections.gmail_message import (
    BODY_BYTE_CAP,
    project_gmail_message,
)
from lifecoach_agent.workspace_agent.projections.task import project_task

__all__ = [
    "BODY_BYTE_CAP",
    "project_calendar_event",
    "project_calendar_list_entry",
    "project_gmail_message",
    "project_task",
]
