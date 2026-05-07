"""Tests for the empty-turn guard. Mirrors a focused subset of
`apps/agent/src/chat/emptyTurnGuard.test.ts` — the cases that exercise
the primary failure modes the live PR-54 service hit."""

from __future__ import annotations

from typing import Any

from lifecoach_agent.chat.empty_turn_guard import (
    find_empty_turn_gaps,
    inject_recovery_events,
    is_poisoned_model_event,
    pick_recovery_text,
)


def _user_text(text: str) -> dict[str, Any]:
    return {"content": {"role": "user", "parts": [{"text": text}]}}


def _model_text(text: str) -> dict[str, Any]:
    return {"content": {"role": "model", "parts": [{"text": text}]}}


def _model_call(name: str) -> dict[str, Any]:
    return {
        "content": {
            "role": "model",
            "parts": [{"functionCall": {"name": name, "args": {}}}],
        }
    }


def _user_response(name: str) -> dict[str, Any]:
    return {
        "content": {
            "role": "user",
            "parts": [{"functionResponse": {"name": name, "response": {"status": "ok"}}}],
        }
    }


def _empty_model() -> dict[str, Any]:
    """The poisoned shape: model role, no text, no calls, no responses."""
    return {"content": {"role": "model", "parts": [{"text": ""}]}}


# --- pick_recovery_text -------------------------------------------------


def test_recovery_text_default_when_no_tools() -> None:
    assert pick_recovery_text([]) == "Done. What next?"


def test_recovery_text_writes_only_get_saved() -> None:
    out = pick_recovery_text([{"name": "log_goal_update"}, {"name": "update_user_profile"}])
    assert out == "Got it — saved."


def test_recovery_text_reads_only_invite_followup() -> None:
    out = pick_recovery_text([{"name": "call_workspace"}])
    assert out == "All set — anything jump out, or want me to dig in?"


def test_recovery_text_mixed_falls_back_to_default() -> None:
    out = pick_recovery_text([{"name": "log_goal_update"}, {"name": "call_workspace"}])
    assert out == "Done. What next?"


# --- is_poisoned_model_event --------------------------------------------


def test_poisoned_detected_when_empty_text_and_no_call() -> None:
    assert is_poisoned_model_event(_empty_model())


def test_not_poisoned_when_text_present() -> None:
    assert not is_poisoned_model_event(_model_text("hi"))


def test_not_poisoned_when_function_call_present() -> None:
    assert not is_poisoned_model_event(_model_call("log_goal_update"))


def test_not_poisoned_when_user_role() -> None:
    assert not is_poisoned_model_event(_user_text(""))


# --- find_empty_turn_gaps -----------------------------------------------


def test_no_gaps_when_pairs_resolve() -> None:
    events: list[Any] = [_user_text("hi"), _model_text("hello")]
    assert find_empty_turn_gaps(events) == []


def test_gap_after_function_response_with_no_model_text() -> None:
    events: list[Any] = [
        _user_text("save my goal"),
        _model_call("log_goal_update"),
        _user_response("log_goal_update"),
        # Model emits no follow-up text → gap at end.
    ]
    assert find_empty_turn_gaps(events) == [len(events)]


def test_gap_when_user_speaks_again_before_model_replies() -> None:
    events: list[Any] = [_user_text("first"), _user_text("second")]
    # Both pending; gap is *between* them and at end.
    gaps = find_empty_turn_gaps(events)
    assert gaps == [1, 2]


def test_no_gap_when_model_replies_after_tool_call_pair() -> None:
    events: list[Any] = [
        _user_text("save my goal"),
        _model_call("log_goal_update"),
        _user_response("log_goal_update"),
        _model_text("Logged. Sleep's worth more than the afternoon hit."),
    ]
    assert find_empty_turn_gaps(events) == []


# --- inject_recovery_events ---------------------------------------------


def test_inject_drops_poisoned_event_and_inserts_recovery() -> None:
    events: list[Any] = [_user_text("hi"), _empty_model()]
    out = inject_recovery_events(events)
    # Poisoned dropped, recovery inserted.
    assert len(out) == 2
    assert out[0] is events[0]  # original user kept
    rec = out[1]
    assert isinstance(rec, dict)
    assert rec["content"]["role"] == "model"
    assert rec["content"]["parts"][0]["text"] == "Done. What next?"


def test_inject_is_idempotent() -> None:
    events: list[Any] = [_user_text("hi")]
    once = inject_recovery_events(events)
    twice = inject_recovery_events(once)
    # Both passes should produce the same final shape.
    assert [_strip_ids(e) for e in twice] == [_strip_ids(e) for e in once]


def _strip_ids(ev: Any) -> Any:
    if isinstance(ev, dict):
        out = dict(ev)
        out.pop("id", None)
        return out
    return ev
