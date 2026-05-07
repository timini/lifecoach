"""Evening gratitude practice.

Mirrors `apps/agent/src/practices/eveningGratitude.ts`. Time gate
18:00–22:59 local, idempotent via `practices.evening_gratitude.last_logged`.
The `log_gratitude` tool factory is wired in Phase 6 once the
`UserProfileStore` lands; for Phase 3 only the directive is exposed.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from lifecoach_agent.practices.day_clock import local_date_and_hour
from lifecoach_agent.practices.types import (
    Practice,
    PracticeCtx,
    PracticeDeps,
    PracticeTool,
)

ID = "evening_gratitude"
ENTRIES_PATH = f"practices.{ID}.entries"
LAST_LOGGED_PATH = f"practices.{ID}.last_logged"
EVENING_START_HOUR = 18
EVENING_END_HOUR = 23  # exclusive — 23:00 onwards skips


def directive(ctx: PracticeCtx) -> str | None:
    today, hour = local_date_and_hour(ctx.base.now, ctx.base.timezone)
    if hour < EVENING_START_HOUR or hour >= EVENING_END_HOUR:
        return None
    last_logged = ctx.practice_state.get("last_logged")
    if isinstance(last_logged, str) and last_logged == today:
        return None
    return (
        "EVENING_GRATITUDE (practice on, evening window, not yet logged today):\n"
        "It's evening and the user hasn't shared a gratitude entry yet today. When the "
        "moment fits — after a check-in, between topics, or as the chat winds down — "
        "gently invite one thing they're grateful for. ONE soft ask only; if they "
        "decline or change subject, drop it. When they share, immediately call "
        'log_gratitude({ text: "<their words, lightly cleaned up>" }) and continue '
        "normally without announcing the save."
    )


def _read_entries(profile: Any) -> list[dict[str, str]]:
    if not isinstance(profile, dict):
        return []
    practices = profile.get("practices")
    if not isinstance(practices, dict):
        return []
    slot = practices.get(ID)
    if not isinstance(slot, dict):
        return []
    entries = slot.get("entries")
    if not isinstance(entries, list):
        return []
    out: list[dict[str, str]] = []
    for e in entries:
        if (
            isinstance(e, dict)
            and isinstance(e.get("date"), str)
            and isinstance(e.get("text"), str)
            and isinstance(e.get("ts"), str)
        ):
            out.append(e)
    return out


def make_log_gratitude(deps: PracticeDeps, uid: str) -> PracticeTool:
    """Build the `log_gratitude(text=...)` callable. Captures `deps`/`uid`
    in the closure; the agent factory wraps the returned function in a
    FunctionTool with the right metadata."""

    async def log_gratitude(text: str) -> dict[str, Any]:
        try:
            now = datetime.now(UTC)
            date = now.strftime("%Y-%m-%d")
            ts = now.isoformat().replace("+00:00", "Z")
            try:
                profile = await deps.profile_store.read(uid)
            except Exception:
                profile = None
            existing = _read_entries(profile)
            entry = {"date": date, "text": text, "ts": ts}
            next_entries = [*existing, entry]
            await deps.profile_store.update_path(uid, ENTRIES_PATH, next_entries)
            await deps.profile_store.update_path(uid, LAST_LOGGED_PATH, date)
            return {"status": "ok", "count": len(next_entries)}
        except Exception as err:  # noqa: BLE001 — surface the message to the LLM
            return {"status": "error", "message": str(err)}

    return log_gratitude


def tools(deps: PracticeDeps, uid: str) -> list[PracticeTool]:
    return [make_log_gratitude(deps, uid)]


evening_gratitude = Practice(
    id=ID,
    label="Evening gratitude",
    description=(
        "Each evening, the coach gently invites one thing you’re grateful for and saves it."
    ),
    offer_hint=(
        "If the user mentions ending their day, winding down, or expresses positive "
        "reflection, consider offering Evening gratitude."
    ),
    directive=directive,
    tools=tools,
)
