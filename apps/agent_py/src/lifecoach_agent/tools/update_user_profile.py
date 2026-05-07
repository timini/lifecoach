"""update_user_profile tool — schema-free profile writes.

The coach can invent any dotted path (`pets.name`,
`morning_routine.coffee_first`, `volunteering`, …) and persist it to
the user's YAML. See memory/feedback_yaml_schema_free.md.

`value` is still a nullable string at the LLM call-site; `_resolve_value`
applies two convenience coercions:
  - `age` → number
  - `goals.{short,medium,long}_term` → JSON-parsed list of strings
Everything else passes through as a string.

Mirrors `apps/agent/src/tools/updateUserProfile.ts`.
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from typing import Any

from lifecoach_agent.storage.profile_history import ProfileHistoryEntry, ProfileHistoryStore
from lifecoach_agent.storage.user_profile import UserProfileStore

_log = logging.getLogger(__name__)


_GOAL_LIST_PATHS = frozenset({"goals.short_term", "goals.medium_term", "goals.long_term"})


def _resolve_value(path: str, value: str | None) -> Any:
    if value is None:
        return None
    if path == "age":
        try:
            return int(value)
        except ValueError:
            try:
                return float(value)
            except ValueError as e:
                raise ValueError(f'age must be numeric, got "{value}"') from e
    if path in _GOAL_LIST_PATHS:
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError as err:
            raise ValueError(
                f"goals.*_term must be a JSON array of strings, got {value!r}: {err}"
            ) from err
        if not isinstance(parsed, list) or not all(isinstance(x, str) for x in parsed):
            raise ValueError(f"goals.*_term must be a JSON array of strings, got {value!r}")
        return parsed
    return value


def create_update_user_profile_tool(
    *,
    store: UserProfileStore,
    uid: str,
    history: ProfileHistoryStore | None = None,
) -> Any:
    """Build a closure-bound `update_user_profile` tool. Optional
    `history` audit-log store; production wiring always supplies it."""

    async def update_user_profile(path: str, value: str | None) -> dict[str, Any]:
        """Persist a structured fact about the user (or someone in their
        life) to their profile YAML. Call this PROACTIVELY the FIRST
        time you hear any of:
        (a) a name of someone in their life — partner, child, sibling,
        parent, close friend, regular colleague (e.g. "Maya's parents'
        evening" → save Maya);
        (b) the user's own identity facts — name, city/postcode,
        occupation, key health context (injuries, conditions);
        (c) interests, hobbies, regular sports — theirs OR a family
        member's;
        (d) routines ("Tuesday yoga", "Sunday long runs");
        (e) strong preferences/dislikes ("I never drink coffee after 2pm").
        Use any sensible dotted path; invent freely
        (family.children[0].name, family.partner.name, occupation.title,
        health.injuries.calf_strain, preferences.coffee_cutoff). The
        profile has no fixed schema. Heuristic: if a fact would still
        matter next month, capture it now. Never announce ("let me note
        that") — save silently and continue talking.

        Args:
            path: Dotted path into the user profile YAML (e.g. "name",
                "family.children", "pets.species", "volunteering").
                Invent new keys freely when a fact doesn't fit an
                existing slot — the profile has no fixed schema.
            value: New value as a string. Numbers: stringified (age is
                coerced back to number). Goals tiers
                (goals.short_term etc): JSON array string. Null clears
                the field.
        """
        try:
            resolved = _resolve_value(path, value)
            before = await store.read_path(uid, path)
            profile = await store.update_path(uid, path, resolved)
            at = datetime.now(UTC).isoformat().replace("+00:00", "Z")
            if history is not None:
                try:
                    await history.append(
                        uid,
                        ProfileHistoryEntry(
                            path=path,
                            before=before,
                            after=resolved,
                            at=at,
                        ),
                    )
                except Exception as log_err:  # noqa: BLE001
                    _log.error("profile.history.append failed: %s", log_err)
            return {
                "status": "ok",
                "updated_path": path,
                "new_value": resolved,
                "previous_value": before,
                "modified_at": at,
                "profile_after": profile,
            }
        except Exception as err:  # noqa: BLE001
            return {"status": "error", "message": str(err)}

    from google.adk.tools import FunctionTool

    return FunctionTool(update_user_profile)
