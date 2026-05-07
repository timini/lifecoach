"""Chat-loop helpers — empty-turn recovery, sentinel constants."""

from lifecoach_agent.chat.empty_turn_guard import (
    CONTINUE_SENTINEL,
    find_empty_turn_gaps,
    inject_recovery_events,
    is_poisoned_model_event,
    make_recovery_event,
    pick_recovery_text,
)

__all__ = [
    "CONTINUE_SENTINEL",
    "find_empty_turn_gaps",
    "inject_recovery_events",
    "is_poisoned_model_event",
    "make_recovery_event",
    "pick_recovery_text",
]
