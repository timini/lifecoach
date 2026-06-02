"""Internal sub-agent tools (5 reads) + main-facing writes (5)."""

from lifecoach_agent.workspace_agent.tools.add_calendar_event import (
    ADD_CALENDAR_EVENT_TOOL_NAME,
    create_add_calendar_event_tool,
)
from lifecoach_agent.workspace_agent.tools.add_task import (
    ADD_TASK_TOOL_NAME,
    create_add_task_tool,
)
from lifecoach_agent.workspace_agent.tools.archive_messages import (
    ARCHIVE_MESSAGES_TOOL_NAME,
    create_archive_messages_tool,
)
from lifecoach_agent.workspace_agent.tools.complete_task import (
    COMPLETE_TASK_TOOL_NAME,
    create_complete_task_tool,
)
from lifecoach_agent.workspace_agent.tools.create_draft_email import (
    CREATE_DRAFT_EMAIL_TOOL_NAME,
    create_create_draft_email_tool,
)
from lifecoach_agent.workspace_agent.tools.get_message import (
    GET_MESSAGE_TOOL_NAME,
    create_get_message_tool,
)
from lifecoach_agent.workspace_agent.tools.list_events import (
    LIST_EVENTS_TOOL_NAME,
    create_list_events_tool,
)
from lifecoach_agent.workspace_agent.tools.list_inbox import (
    LIST_INBOX_TOOL_NAME,
    create_list_inbox_tool,
)
from lifecoach_agent.workspace_agent.tools.list_tasks import (
    LIST_TASKS_TOOL_NAME,
    create_list_tasks_tool,
)
from lifecoach_agent.workspace_agent.tools.search_messages import (
    SEARCH_MESSAGES_TOOL_NAME,
    create_search_messages_tool,
)

__all__ = [
    "ADD_CALENDAR_EVENT_TOOL_NAME",
    "ADD_TASK_TOOL_NAME",
    "ARCHIVE_MESSAGES_TOOL_NAME",
    "COMPLETE_TASK_TOOL_NAME",
    "CREATE_DRAFT_EMAIL_TOOL_NAME",
    "GET_MESSAGE_TOOL_NAME",
    "LIST_EVENTS_TOOL_NAME",
    "LIST_INBOX_TOOL_NAME",
    "LIST_TASKS_TOOL_NAME",
    "SEARCH_MESSAGES_TOOL_NAME",
    "create_add_calendar_event_tool",
    "create_add_task_tool",
    "create_archive_messages_tool",
    "create_complete_task_tool",
    "create_create_draft_email_tool",
    "create_get_message_tool",
    "create_list_events_tool",
    "create_list_inbox_tool",
    "create_list_tasks_tool",
    "create_search_messages_tool",
]
