"""log_goal_update tool — append an entry to goal_updates.json for this
user. Closed over uid so the LLM never has to provide it.

Mirrors `apps/agent/src/tools/logGoalUpdate.ts`.
"""

from __future__ import annotations

from typing import Any

from lifecoach_agent.storage.goal_updates import GoalUpdatesStore


def create_log_goal_update_tool(*, store: GoalUpdatesStore, uid: str) -> Any:
    async def log_goal_update(goal: str, status: str, note: str | None = None) -> dict[str, Any]:
        """Record a goal update when the user tells you something about
        their progress. Call this whenever they mention starting, making
        progress on, completing, pausing, or abandoning a goal. Never
        announce that you are logging — just speak naturally and save
        in the background.

        Args:
            goal: Short name of the goal, e.g. "Running",
                "Garden renovation".
            status: One of started | progress | completed | paused |
                abandoned.
            note: Optional short context: what they did, how they felt,
                what changed.
        """
        try:
            entry = await store.append(uid, goal=goal, status=status, note=note)
            return {"status": "ok", "entry": entry.model_dump(exclude_none=True)}
        except Exception as err:  # noqa: BLE001
            return {"status": "error", "message": str(err)}

    from google.adk.tools import FunctionTool

    return FunctionTool(log_goal_update)
