"""Unit tests for the `backgroundProposedActions` store (ADR 0001 §6, step 5b)."""

from __future__ import annotations

import pytest

from lifecoach_agent.contracts.background import BackgroundProposedAction
from lifecoach_agent.storage.background_proposed_actions import (
    BackgroundProposedActionStore,
    create_background_proposed_action_store,
)
from tests.unit.storage._bg_firestore import FakeBackgroundFirestore

pytestmark = pytest.mark.asyncio


def _action(aid: str = "a1", **overrides: object) -> BackgroundProposedAction:
    base: dict[str, object] = {
        "id": aid,
        "uid": "uid-1",
        "runId": "run-1",
        "notificationId": "n1",
        "type": "archive_message",
        "status": "proposed",
        "sourceMessageIds": ["m1"],
        "summary": "Archive the newsletter from Acme",
        "createdAt": "2026-05-15T08:00:05.000Z",
    }
    base.update(overrides)
    return BackgroundProposedAction.model_validate(base)


def _store(fs: FakeBackgroundFirestore) -> BackgroundProposedActionStore:
    return create_background_proposed_action_store(firestore=fs)  # type: ignore[arg-type]


async def test_create_then_get_round_trips() -> None:
    fs = FakeBackgroundFirestore()
    store = _store(fs)
    action = _action()
    assert await store.create(action) is True
    assert await store.get("a1") == action


async def test_create_refuses_to_overwrite() -> None:
    fs = FakeBackgroundFirestore()
    store = _store(fs)
    await store.create(_action(summary="original"))
    assert await store.create(_action(summary="replay")) is False
    assert fs.docs["backgroundProposedActions/a1"]["summary"] == "original"


async def test_create_canonicalizes_created_at() -> None:
    fs = FakeBackgroundFirestore()
    store = _store(fs)
    await store.create(_action(createdAt="2026-05-15T08:00:05Z"))
    assert fs.docs["backgroundProposedActions/a1"]["createdAt"] == "2026-05-15T08:00:05.000Z"


async def test_get_missing_returns_none() -> None:
    assert await _store(FakeBackgroundFirestore()).get("nope") is None


async def test_get_empty_doc_returns_none() -> None:
    fs = FakeBackgroundFirestore()
    fs.docs["backgroundProposedActions/empty"] = {}
    assert await _store(fs).get("empty") is None
