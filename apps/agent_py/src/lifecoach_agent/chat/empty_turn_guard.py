"""Empty-turn guard — recovery for the case where Gemini calls a tool
but returns no follow-up text.

Mirrors `apps/agent/src/chat/emptyTurnGuard.ts`. Pure helpers, no IO.
Wired into the /chat SSE loop (forward guard, prevents new poisoning)
and `FirestoreSessionService.get_session` (backward sanitiser, repairs
already-poisoned sessions in-memory at load time).

Events flow through this module either as ADK `Event` objects (dotted
attribute access) or as Firestore-deserialized dicts. The `_parts_of`
/ `_role_of` helpers handle both shapes via a tiny duck-typed
adapter — keeping the guard agnostic of which side called it.
"""

from __future__ import annotations

import secrets
import time
from collections.abc import Iterable
from typing import Any

# Sentinel user message used to nudge the model when its previous turn
# produced no text. Sent server-side as the `newMessage` for a single
# retry pass; the prompt explains its meaning to the model. Filtered out
# of session history at every read site so the user never sees it.
CONTINUE_SENTINEL = "__continue__"


# Tool-name groupings drive the recovery copy.
_WRITE_TOOLS = frozenset({"update_user_profile", "log_goal_update", "memory_save"})
_READ_TOOLS = frozenset({"call_workspace", "google_search"})


def pick_recovery_text(tools: Iterable[Any]) -> str:
    """Pick a recovery message to inject when the model called tools but
    emitted no follow-up text. Copy intentionally invites another user
    turn so the conversation doesn't dead-end on a robotic "OK"."""
    names = [_name_of(t) for t in tools]
    if not names:
        return "Done. What next?"
    if all(n in _WRITE_TOOLS for n in names):
        return "Got it — saved."
    if all(n in _READ_TOOLS for n in names):
        return "All set — anything jump out, or want me to dig in?"
    return "Done. What next?"


def _name_of(tool: Any) -> str:
    if isinstance(tool, dict):
        return str(tool.get("name", ""))
    return str(getattr(tool, "name", ""))


# --- Event shape adapters -------------------------------------------------


def _content_of(event: Any) -> Any:
    if isinstance(event, dict):
        return event.get("content")
    return getattr(event, "content", None)


def _role_of(event: Any) -> str | None:
    content = _content_of(event)
    if content is None:
        return None
    role = content.get("role") if isinstance(content, dict) else getattr(content, "role", None)
    return role if isinstance(role, str) else None


def _parts_of(event: Any) -> list[Any]:
    content = _content_of(event)
    if content is None:
        return []
    parts = content.get("parts") if isinstance(content, dict) else getattr(content, "parts", None)
    if not isinstance(parts, list):
        return []
    return parts


def _part_field(part: Any, field: str) -> Any:
    if isinstance(part, dict):
        return part.get(field)
    return getattr(part, field, None)


def _has_non_empty_text(event: Any) -> bool:
    for p in _parts_of(event):
        text = _part_field(p, "text")
        if isinstance(text, str) and text:
            return True
    return False


def _has_function_call(event: Any) -> bool:
    return any(_part_field(p, "functionCall") is not None for p in _parts_of(event))


def _has_function_response(event: Any) -> bool:
    return any(_part_field(p, "functionResponse") is not None for p in _parts_of(event))


# --- Detection + repair ---------------------------------------------------


def is_poisoned_model_event(event: Any) -> bool:
    """True for the gemini-3-flash-preview thought-only STOP failure
    mode: a model event with no visible text, no functionCall, no
    functionResponse. Replaying it teaches the model to keep emitting
    empty turns; we filter at load time and replace with a recovery
    message."""
    if _role_of(event) != "model":
        return False
    if _has_non_empty_text(event):
        return False
    if _has_function_call(event):
        return False
    return not _has_function_response(event)


def find_empty_turn_gaps(events: list[Any]) -> list[int]:
    """Return positions in `events` (in the ORIGINAL array) where a
    synthetic recovery event needs to be inserted to break the silence
    pattern. Two failure modes detected:
      1. user/functionResponse not followed by model text before the
         next user text or end of array.
      2. user/text not followed by model text before the next user text
         or end of array.
    Empty-text model events and tool-call-only model events do not
    satisfy the "owes a reply" requirement."""
    gaps: list[int] = []
    pending_text_response = False

    for i, ev in enumerate(events):
        role = _role_of(ev)

        if role == "user" and _has_function_response(ev):
            pending_text_response = True
            continue
        if role == "user" and _has_non_empty_text(ev):
            if pending_text_response:
                gaps.append(i)
            pending_text_response = True
            continue
        if role == "model" and _has_non_empty_text(ev):
            pending_text_response = False
        # role=model with only functionCall / empty text part / other
        # shape doesn't resolve the pending response.
    if pending_text_response:
        gaps.append(len(events))
    return gaps


def make_recovery_event(
    text: str,
    invocation_id: str,
    now: int | None = None,
) -> dict[str, Any]:
    """Build a synthetic event carrying recovery text as a model turn.
    Returned as a dict; the SSE writer / SessionService can wrap it in
    an ADK Event if needed. Mirrors the TS shape so a Firestore round-
    trip is identical."""
    ts = now if now is not None else int(time.time())
    return {
        "invocationId": invocation_id,
        "author": "lifecoach",
        "id": f"recovery-{invocation_id}-{secrets.token_hex(3)}",
        "timestamp": ts,
        "content": {"role": "model", "parts": [{"text": text}]},
        "actions": {
            "stateDelta": {},
            "artifactDelta": {},
            "requestedAuthConfigs": {},
            "requestedToolConfirmations": {},
        },
    }


def inject_recovery_events(events: list[Any]) -> list[Any]:
    """Splice synthetic recovery events into a stored events array at
    every gap detected by `find_empty_turn_gaps`, AND drop poisoned
    model events. Returns a NEW list; the input is untouched.
    Idempotent: a second pass produces no further changes because
    recovery events satisfy `_has_non_empty_text` and poisoned events
    have already been removed."""
    gaps = find_empty_turn_gaps(events)
    result: list[Any] = []
    g = 0
    for i, ev in enumerate(events):
        if g < len(gaps) and gaps[g] == i:
            result.append(make_recovery_event("Done. What next?", f"gap-{i}"))
            g += 1
        if is_poisoned_model_event(ev):
            continue
        result.append(ev)
    if g < len(gaps) and gaps[g] == len(events):
        result.append(make_recovery_event("Done. What next?", "gap-end"))
    return result
