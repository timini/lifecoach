"""memory_save tool — persist long-term narrative context to Vertex
Memory Bank.

The corresponding `memory_search` happens server-side every turn (see
prompt builder), NOT via a tool call — so the coach never has to say
"let me check my memory."

Mirrors `apps/agent/src/tools/memorySave.ts`.
"""

from __future__ import annotations

from typing import Any

from lifecoach_agent.context.memory import MemoryClient


def create_memory_save_tool(*, client: MemoryClient, uid: str) -> Any:
    """Build a closure-bound `memory_save` tool. Each user gets their own
    instance with the client + uid baked in."""

    async def memory_save(text: str) -> dict[str, Any]:
        """Save a long-term narrative memory — the kind of context that
        does NOT fit a single profile slot but matters for future
        conversations. Call PROACTIVELY when you learn:
        (a) relational context about people in their life ("Maya is doing
        well at violin and enjoys it", "co-founder Jordan is going
        through a divorce");
        (b) ongoing projects, training plans, or goals with detail too
        rich for a path ("training for half-marathon, calf strain in
        April, comfortable at 6.5k");
        (c) life circumstances, health context, work situation that
        affects coaching;
        (d) recurring people you've met before resurfacing in conversation.
        Often pairs with update_user_profile (one captures the slot, the
        other the narrative) — call both when both apply. Write in
        third-person, self-contained so a future session reads it
        standalone ("the user's daughter Maya, age 8, plays violin and
        enjoys it"). NEVER announce ("let me remember that") — save
        silently and continue the conversation.

        Args:
            text: A self-contained factual statement about the user,
                written in the third person. Example: "User is training
                for a half-marathon and had a calf strain in April 2026."
        """
        if not isinstance(text, str) or len(text) < 5:
            return {"status": "error", "message": "text must be at least 5 characters"}
        try:
            await client.save(uid, text)
            return {"status": "ok"}
        except Exception as err:  # noqa: BLE001
            return {"status": "error", "message": str(err)}

    from google.adk.tools import FunctionTool

    return FunctionTool(memory_save)
