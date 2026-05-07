"""Practice protocol — the shape every practice (`day_planning`,
`evening_gratitude`, `journaling`, …) must satisfy.

A practice bundles three optional things:
  1. A prompt directive injected when the user has it ON.
  2. Few-shot examples appended to the EXAMPLES block when ON.
  3. A set of tools registered when ON (e.g. `log_gratitude`).

Tool factories take a `PracticeDeps` and a uid; they return zero or
more tool callables. The actual ADK FunctionTool wiring happens in the
agent factory (Phase 6) — practices just expose their behaviour.

Mirrors `apps/agent/src/practices/types.ts`.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Protocol

if TYPE_CHECKING:
    from lifecoach_agent.contracts import UserProfile
    from lifecoach_agent.prompt.build_instruction import InstructionContext


class ProfileStoreProtocol(Protocol):
    """Minimal shape practice tools need from a user-profile store. The
    real implementation lands in Phase 5 (`storage.user_profile`)."""

    async def read(self, uid: str) -> UserProfile | None: ...
    async def write(self, uid: str, profile: UserProfile) -> None: ...
    async def update_path(self, uid: str, path: str, value: Any) -> UserProfile: ...


@dataclass(frozen=True)
class PracticeDeps:
    profile_store: ProfileStoreProtocol


@dataclass(frozen=True)
class PracticeCtx:
    """Full instruction context plus this practice's state slice."""

    base: InstructionContext
    practice_state: dict[str, Any] = field(default_factory=dict)


# A practice tool is just a Python callable with metadata attached
# elsewhere. The agent factory binds it to a FunctionTool.
PracticeTool = Callable[..., Any]


@dataclass(frozen=True)
class Practice:
    """All fields except `id`, `label`, `description` are optional."""

    id: str
    label: str
    description: str
    offer_hint: str | None = None
    directive: Callable[[PracticeCtx], str | None] | None = None
    examples: Callable[[PracticeCtx], str | None] | None = None
    tools: Callable[[PracticeDeps, str], list[PracticeTool]] | None = None


def is_practice_enabled(profile: UserProfile | None, practice_id: str) -> bool:
    """Truthy if the user has the practice turned on. Both `True` and the
    string `"true"` (case-insensitive) count, mirroring the TS check."""
    if not profile:
        return False
    practices = profile.get("practices")
    if not isinstance(practices, dict):
        return False
    slot = practices.get(practice_id)
    if not isinstance(slot, dict):
        return False
    flag = slot.get("enabled")
    if flag is True:
        return True
    if isinstance(flag, str):
        return flag.lower() == "true"
    return False


def practice_state_for(profile: UserProfile | None, practice_id: str) -> dict[str, Any]:
    """The practice's per-instance state slice from the profile, or {}."""
    if not profile:
        return {}
    practices = profile.get("practices")
    if not isinstance(practices, dict):
        return {}
    slot = practices.get(practice_id)
    if not isinstance(slot, dict):
        return {}
    return slot
