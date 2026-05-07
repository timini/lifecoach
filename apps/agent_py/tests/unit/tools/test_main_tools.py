"""Smoke tests for the main-agent tool surface — exercises each
tool's underlying callable. The ADK FunctionTool wrapper is registered
in the agent factory (Phase 9); we test the pure callable here so the
suite stays fast and dep-free."""

from __future__ import annotations

import pytest

from lifecoach_agent.tools.ask_choice import (
    ask_multiple_choice_question,
    ask_single_choice_question,
)
from lifecoach_agent.tools.auth_user import auth_user
from lifecoach_agent.tools.connect_workspace import connect_workspace
from lifecoach_agent.tools.update_user_profile import _resolve_value
from lifecoach_agent.tools.upgrade_to_pro import upgrade_to_pro

# --- auth_user ---


@pytest.mark.asyncio
async def test_auth_user_google_no_email() -> None:
    out = await auth_user(mode="google")
    assert out == {"status": "auth_prompted", "mode": "google"}


@pytest.mark.asyncio
async def test_auth_user_email_passes_through() -> None:
    out = await auth_user(mode="email", email="x@y.z")
    assert out == {"status": "auth_prompted", "mode": "email", "email": "x@y.z"}


# --- connect_workspace ---


@pytest.mark.asyncio
async def test_connect_workspace_returns_oauth_prompted() -> None:
    out = await connect_workspace()
    assert out == {"status": "oauth_prompted"}


# --- upgrade_to_pro ---


@pytest.mark.asyncio
async def test_upgrade_to_pro_returns_upgrade_prompted() -> None:
    out = await upgrade_to_pro()
    assert out == {"status": "upgrade_prompted"}


# --- ask_choice family ---


@pytest.mark.asyncio
async def test_ask_single_choice_renders() -> None:
    out = await ask_single_choice_question(question="How are you?", options=["good", "meh"])
    assert out["kind"] == "single"
    assert out["options"] == ["good", "meh"]


@pytest.mark.asyncio
async def test_ask_multiple_choice_renders() -> None:
    out = await ask_multiple_choice_question(question="Which apply?", options=["a", "b", "c"])
    assert out["kind"] == "multiple"
    assert out["options"] == ["a", "b", "c"]


@pytest.mark.asyncio
async def test_ask_choice_rejects_one_option() -> None:
    with pytest.raises(ValueError):
        await ask_single_choice_question(question="q", options=["only one"])


@pytest.mark.asyncio
async def test_ask_choice_rejects_empty_option() -> None:
    with pytest.raises(ValueError):
        await ask_single_choice_question(question="q", options=["a", ""])


# --- _resolve_value (update_user_profile) ---


def test_resolve_value_passes_strings_through() -> None:
    assert _resolve_value("name", "Tim") == "Tim"


def test_resolve_value_age_coerces_to_number() -> None:
    assert _resolve_value("age", "42") == 42


def test_resolve_value_age_rejects_non_numeric() -> None:
    with pytest.raises(ValueError, match="age must be numeric"):
        _resolve_value("age", "old")


def test_resolve_value_null_passes_through() -> None:
    assert _resolve_value("name", None) is None


def test_resolve_value_goals_short_term_parses_json() -> None:
    out = _resolve_value("goals.short_term", '["run 5k", "read 1 book"]')
    assert out == ["run 5k", "read 1 book"]


def test_resolve_value_goals_rejects_non_array() -> None:
    with pytest.raises(ValueError, match="goals"):
        _resolve_value("goals.short_term", "just a string")


def test_resolve_value_goals_rejects_non_string_items() -> None:
    with pytest.raises(ValueError, match="goals"):
        _resolve_value("goals.short_term", "[1, 2, 3]")
