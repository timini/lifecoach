"""Unit tests for the `backgroundNotifications` store (ADR 0001 §6, step 5b)."""

from __future__ import annotations

import pytest

from lifecoach_agent.contracts.background import BackgroundNotification
from lifecoach_agent.storage.background_notifications import (
    BackgroundNotificationStore,
    create_background_notification_store,
)
from tests.unit.storage._bg_firestore import FakeBackgroundFirestore

pytestmark = pytest.mark.asyncio


def _notification(nid: str = "n1", **overrides: object) -> BackgroundNotification:
    base: dict[str, object] = {
        "id": nid,
        "uid": "uid-1",
        "runId": "run-1",
        "kind": "email_triage_daily",
        "status": "unread",
        "title": "3 emails need attention",
        "summary": "2 actions, 1 event since yesterday.",
        "items": [
            {
                "messageId": "m1",
                "threadId": "t1",
                "bucket": "actions",
                "subject": "Invoice due",
                "snippet": "Your invoice is due Friday",
            }
        ],
        "proposedActions": ["a1"],
        "createdAt": "2026-05-15T08:00:05.000Z",
    }
    base.update(overrides)
    return BackgroundNotification.model_validate(base)


def _store(fs: FakeBackgroundFirestore) -> BackgroundNotificationStore:
    return create_background_notification_store(firestore=fs)  # type: ignore[arg-type]


async def test_create_then_get_round_trips() -> None:
    fs = FakeBackgroundFirestore()
    store = _store(fs)
    notif = _notification()
    assert await store.create(notif) is True
    assert await store.get("n1") == notif


async def test_create_refuses_to_overwrite() -> None:
    fs = FakeBackgroundFirestore()
    store = _store(fs)
    await store.create(_notification(title="original"))
    assert await store.create(_notification(title="replay")) is False
    assert fs.docs["backgroundNotifications/n1"]["title"] == "original"


async def test_get_missing_returns_none() -> None:
    assert await _store(FakeBackgroundFirestore()).get("nope") is None


async def test_get_empty_doc_returns_none() -> None:
    fs = FakeBackgroundFirestore()
    fs.docs["backgroundNotifications/empty"] = {}
    assert await _store(fs).get("empty") is None
