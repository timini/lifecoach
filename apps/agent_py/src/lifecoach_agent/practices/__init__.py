"""Practices registry.

Every entry here must have a matching record in
`lifecoach_agent.contracts.PRACTICE_METADATA` (the Pydantic mirror of
shared-types). The parity check at module load crashes the import on
mismatch, surfacing the divergence in CI rather than silently dropping
a toggle from the settings UI.

Adding a new practice:
  1. Append to PRACTICE_METADATA in `contracts.models`.
  2. Add a new file here exposing a `Practice`.
  3. Add it to `PRACTICES` below.
  4. The wiring in `prompt.build_instruction` and the agent factory
     already iterates this list.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from lifecoach_agent.contracts import PRACTICE_METADATA
from lifecoach_agent.practices.day_planning import day_planning
from lifecoach_agent.practices.evening_gratitude import evening_gratitude
from lifecoach_agent.practices.journaling import journaling
from lifecoach_agent.practices.types import (
    Practice,
    PracticeCtx,
    PracticeDeps,
    PracticeTool,
    ProfileStoreProtocol,
    is_practice_enabled,
    practice_state_for,
)

if TYPE_CHECKING:
    from lifecoach_agent.contracts import UserProfile

PRACTICES: tuple[Practice, ...] = (evening_gratitude, journaling, day_planning)


def _parity_check() -> None:
    code_ids = {p.id for p in PRACTICES}
    meta_ids = {m.id for m in PRACTICE_METADATA}
    only_in_code = sorted(code_ids - meta_ids)
    only_in_meta = sorted(meta_ids - code_ids)
    if only_in_code or only_in_meta:
        raise RuntimeError(
            "Practices registry mismatch: "
            f"only-in-code=[{','.join(only_in_code)}] "
            f"only-in-metadata=[{','.join(only_in_meta)}]"
        )
    # Label/description must agree so the settings UI matches the runtime.
    for p in PRACTICES:
        meta = next((m for m in PRACTICE_METADATA if m.id == p.id), None)
        if meta is None:
            continue
        if meta.label != p.label or meta.description != p.description:
            raise RuntimeError(
                f'Practice "{p.id}" label/description in code does not match shared-types metadata.'
            )


_parity_check()


def get_enabled_practices(profile: UserProfile | None) -> list[Practice]:
    """The subset of practices the user has switched on."""
    return [p for p in PRACTICES if is_practice_enabled(profile, p.id)]


def get_disabled_practices(profile: UserProfile | None) -> list[Practice]:
    """The subset the user has NOT switched on (offer candidates)."""
    return [p for p in PRACTICES if not is_practice_enabled(profile, p.id)]


__all__ = [
    "PRACTICES",
    "Practice",
    "PracticeCtx",
    "PracticeDeps",
    "PracticeTool",
    "ProfileStoreProtocol",
    "day_planning",
    "evening_gratitude",
    "get_disabled_practices",
    "get_enabled_practices",
    "is_practice_enabled",
    "journaling",
    "practice_state_for",
]
