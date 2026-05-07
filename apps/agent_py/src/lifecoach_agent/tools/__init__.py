"""Main-agent tool factories.

Per CLAUDE.md invariant #2 the agent has NO read tools for routine
context (time, weather, profile, places, recent goal updates) — those
are injected into the system prompt every turn by `prompt.build_instruction`.
Only writes and UI directives are tools.
"""

from lifecoach_agent.tools.ask_choice import (
    ask_multiple_choice_question,
    ask_single_choice_question,
    create_ask_multiple_choice_tool,
    create_ask_single_choice_tool,
)
from lifecoach_agent.tools.auth_user import auth_user, create_auth_user_tool
from lifecoach_agent.tools.connect_workspace import (
    CONNECT_WORKSPACE_TOOL_NAME,
    connect_workspace,
    create_connect_workspace_tool,
)
from lifecoach_agent.tools.log_goal_update import create_log_goal_update_tool
from lifecoach_agent.tools.memory_save import create_memory_save_tool
from lifecoach_agent.tools.update_user_profile import create_update_user_profile_tool
from lifecoach_agent.tools.upgrade_to_pro import (
    UPGRADE_TO_PRO_TOOL_NAME,
    create_upgrade_to_pro_tool,
    upgrade_to_pro,
)

__all__ = [
    "CONNECT_WORKSPACE_TOOL_NAME",
    "UPGRADE_TO_PRO_TOOL_NAME",
    "ask_multiple_choice_question",
    "ask_single_choice_question",
    "auth_user",
    "connect_workspace",
    "create_ask_multiple_choice_tool",
    "create_ask_single_choice_tool",
    "create_auth_user_tool",
    "create_connect_workspace_tool",
    "create_log_goal_update_tool",
    "create_memory_save_tool",
    "create_update_user_profile_tool",
    "create_upgrade_to_pro_tool",
    "upgrade_to_pro",
]
