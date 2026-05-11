"""Journaling practice.

Mirrors `apps/agent/src/practices/journaling.ts`. Always-on directive
(no time-of-day gate). The `journal_entry` tool factory is wired in
Phase 6 once `UserProfileStore` lands.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from lifecoach_agent.practices.types import (
    Practice,
    PracticeCtx,
    PracticeDeps,
    PracticeTool,
)

ID = "journaling"
ENTRIES_PATH = f"practices.{ID}.entries"
MAX_INLINE_ENTRIES = 50


def directive(_ctx: PracticeCtx) -> str:
    return (
        "JOURNALING (practice on):\n"
        "If the user describes something meaningful — a moment, a feeling, a turning "
        "point — gently offer to capture it as a journal entry "
        '("want me to journal that for you?"). When they say more (or say yes and '
        'continue), call journal_entry({ text: "<verbatim or lightly cleaned>", '
        "mood: \"<one word if obvious, e.g. 'frustrated' / 'proud' / 'tired'>\" }). "
        "Don't pitch journaling on every casual remark — pick the genuinely "
        "reflective moments."
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
        if isinstance(e, dict) and isinstance(e.get("ts"), str) and isinstance(e.get("text"), str):
            out.append(e)
    return out


def make_journal_entry(deps: PracticeDeps, uid: str) -> PracticeTool:
    async def journal_entry(text: str, mood: str | None = None) -> dict[str, Any]:
        try:
            ts = datetime.now(UTC).isoformat().replace("+00:00", "Z")
            try:
                profile = await deps.profile_store.read(uid)
            except Exception:
                profile = None
            existing = _read_entries(profile)
            new_entry: dict[str, str] = {"ts": ts, "text": text}
            if mood:
                new_entry["mood"] = mood
            combined = [*existing, new_entry]
            # Keep the inline list bounded — older entries can be archived
            # off-profile in a follow-up; for now we just trim the head.
            if len(combined) > MAX_INLINE_ENTRIES:
                combined = combined[-MAX_INLINE_ENTRIES:]
            await deps.profile_store.update_path(uid, ENTRIES_PATH, combined)
            return {"status": "ok", "count": len(combined)}
        except Exception as err:  # noqa: BLE001
            return {"status": "error", "message": str(err)}

    return journal_entry


def tools(deps: PracticeDeps, uid: str) -> list[PracticeTool]:
    return [make_journal_entry(deps, uid)]


journaling = Practice(
    id=ID,
    label="Journaling",
    description=(
        "When something meaningful comes up, the coach offers to capture it as a journal entry."
    ),
    offer_hint=(
        "If the user opens up about a reflection, feeling, or significant moment and "
        "journaling could help them process it, consider offering Journaling."
    ),
    directive=directive,
    tools=tools,
)
