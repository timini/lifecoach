"""Mirrors the type-helper assertions in
`apps/agent/src/practices/index.test.ts` and `types.ts`."""

from __future__ import annotations

from lifecoach_agent.practices import (
    PRACTICES,
    get_disabled_practices,
    get_enabled_practices,
    is_practice_enabled,
    practice_state_for,
)


def test_is_practice_enabled_handles_truthy_string() -> None:
    profile = {"practices": {"day_planning": {"enabled": "true"}}}
    assert is_practice_enabled(profile, "day_planning") is True


def test_is_practice_enabled_handles_boolean() -> None:
    assert is_practice_enabled({"practices": {"day_planning": {"enabled": True}}}, "day_planning")


def test_is_practice_enabled_returns_false_for_unknown_id() -> None:
    assert is_practice_enabled({"practices": {"day_planning": {"enabled": True}}}, "nope") is False


def test_is_practice_enabled_returns_false_for_falsy_flag() -> None:
    assert (
        is_practice_enabled({"practices": {"day_planning": {"enabled": False}}}, "day_planning")
        is False
    )
    assert (
        is_practice_enabled({"practices": {"day_planning": {"enabled": "no"}}}, "day_planning")
        is False
    )


def test_is_practice_enabled_returns_false_when_profile_missing() -> None:
    assert is_practice_enabled(None, "day_planning") is False


def test_practice_state_for_returns_slice() -> None:
    profile = {
        "practices": {
            "evening_gratitude": {"enabled": True, "last_logged": "2026-04-28"},
        }
    }
    assert practice_state_for(profile, "evening_gratitude") == {
        "enabled": True,
        "last_logged": "2026-04-28",
    }


def test_practice_state_for_returns_empty_dict_when_missing() -> None:
    assert practice_state_for(None, "x") == {}
    assert practice_state_for({}, "x") == {}
    assert practice_state_for({"practices": "wrong"}, "x") == {}


def test_get_enabled_practices_filters_correctly() -> None:
    profile = {
        "practices": {
            "evening_gratitude": {"enabled": True},
            "day_planning": {"enabled": "true"},
            "journaling": {"enabled": False},
        }
    }
    enabled_ids = [p.id for p in get_enabled_practices(profile)]
    assert set(enabled_ids) == {"evening_gratitude", "day_planning"}


def test_get_disabled_practices_filters_correctly() -> None:
    profile = {"practices": {"day_planning": {"enabled": True}}}
    disabled_ids = [p.id for p in get_disabled_practices(profile)]
    # journaling and evening_gratitude are not enabled.
    assert "journaling" in disabled_ids
    assert "evening_gratitude" in disabled_ids
    assert "day_planning" not in disabled_ids


def test_practices_registry_is_complete() -> None:
    """The parity check in `practices.__init__` runs at import time;
    just sanity-check the public list shape here."""
    ids = {p.id for p in PRACTICES}
    assert ids == {"evening_gratitude", "journaling", "day_planning"}
