"""Notion projection helpers.

Strip Notion's wire format (page → properties dict of typed property
objects) into the flat shape the LLM + tree builder can reason about.
"""

from __future__ import annotations

from lifecoach_agent.notion_agent.projections.task import project_notion_task
from lifecoach_agent.notion_agent.projections.task_tree import build_task_tree

__all__ = ["build_task_tree", "project_notion_task"]
