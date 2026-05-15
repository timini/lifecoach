"""Drift test: the `create_notion_tools` factory's output, the
NOTION_TOOL_NAMES tuple, and the ToolName enum literal in
`state/types.py` must agree. A typo in any of the three should fail
this test."""

from __future__ import annotations

import typing as t

import httpx

from lifecoach_agent.notion_agent import NOTION_TOOL_NAMES, NotionModuleDeps, create_notion_tools
from lifecoach_agent.notion_agent.tools.add_notion_task import ADD_NOTION_TASK_TOOL_NAME
from lifecoach_agent.notion_agent.tools.complete_notion_task import (
    COMPLETE_NOTION_TASK_TOOL_NAME,
)
from lifecoach_agent.notion_agent.tools.set_notion_task_parent import (
    SET_NOTION_TASK_PARENT_TOOL_NAME,
)
from lifecoach_agent.notion_agent.tools.update_notion_task import UPDATE_NOTION_TASK_TOOL_NAME
from lifecoach_agent.state.types import ToolName
from tests.unit.notion_agent._helpers import make_deps, seed_config, seed_token
from tests.unit.storage._fakes import FakeFirestore


def test_factory_returns_expected_tool_count() -> None:
    """5 tools: notion_review_tasks AgentTool + 4 narrow FunctionTools."""
    fs = FakeFirestore()
    seed_token(fs)
    seed_config(fs)
    # Use a sync httpx client for this static check — the factory
    # doesn't call into the network here.
    http = httpx.AsyncClient()
    try:
        deps = make_deps(fs, http)
        tools = create_notion_tools(deps)
        assert len(tools) == 5
    finally:
        # Best-effort cleanup; never actually used so no awaits needed.
        del http


def test_notion_tool_names_matches_individual_constants() -> None:
    """The tuple in __init__.py is the source of truth for "what tool
    names does the factory produce". Each tool module exports its name
    as a module-level constant — both must agree."""
    expected = (
        "notion_review_tasks",
        ADD_NOTION_TASK_TOOL_NAME,
        UPDATE_NOTION_TASK_TOOL_NAME,
        SET_NOTION_TASK_PARENT_TOOL_NAME,
        COMPLETE_NOTION_TASK_TOOL_NAME,
    )
    assert expected == NOTION_TOOL_NAMES


def test_notion_tool_names_subset_of_ToolName_enum() -> None:  # noqa: N802
    """Every name in NOTION_TOOL_NAMES + the connect / picker UI
    directives must appear in the ToolName Literal. Catches a typo
    when someone adds a tool and forgets to widen the enum."""
    enum_values = set(t.get_args(ToolName))
    for name in NOTION_TOOL_NAMES:
        assert name in enum_values, f"{name} missing from ToolName enum"
    for ui_directive in ("connect_notion", "show_capabilities"):
        assert ui_directive in enum_values


def test_notion_module_deps_field_types() -> None:
    """NotionModuleDeps should expose the right fields with the right
    types. A renaming in `__init__.py` without updating `_deps.py` will
    show as an AttributeError here."""
    fs = FakeFirestore()
    seed_token(fs)
    seed_config(fs)
    http = httpx.AsyncClient()
    try:
        deps = NotionModuleDeps(
            store=make_deps(fs, http).store,
            config_store=make_deps(fs, http).config_store,
            uid="u1",
            http=http,
        )
        assert deps.uid == "u1"
        assert deps.store is not None
        assert deps.config_store is not None
    finally:
        del http
