"""Regression test for `_build_real_firestore` in `main.py`.

The storage layer's `FirestoreLike` Protocol mirrors the JS firestore-
admin shape (`doc()`, `collection()`, snapshot.`exists` + `data()`).
google-cloud-firestore's async client uses different names
(`document()`, `to_dict()`, plus a list-of-snapshots return on
collection.get()) — the adapter in `main.py` bridges between them.
A deploy regression on PR #56 hit `AttributeError: 'DocumentSnapshot'
object has no attribute 'data'` because the bridge was incomplete.
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest


class _FakeAsyncDocSnap:
    """Mimics `google.cloud.firestore.DocumentSnapshot` (async client)."""

    def __init__(self, payload: dict[str, Any] | None) -> None:
        self._payload = payload

    @property
    def exists(self) -> bool:
        return self._payload is not None

    def to_dict(self) -> dict[str, Any] | None:
        return None if self._payload is None else dict(self._payload)


class _FakeAsyncDocRef:
    def __init__(self, snap: _FakeAsyncDocSnap) -> None:
        self._snap = snap
        self.last_set: tuple[dict[str, Any], bool] | None = None

    async def get(self) -> _FakeAsyncDocSnap:
        return self._snap

    async def set(self, value: dict[str, Any], merge: bool = False) -> None:
        self.last_set = (value, merge)

    async def delete(self) -> None:  # pragma: no cover - smoke
        pass


class _FakeAsyncCollRef:
    def __init__(self, snaps: list[_FakeAsyncDocSnap]) -> None:
        self._snaps = snaps

    async def get(self) -> list[_FakeAsyncDocSnap]:
        return list(self._snaps)


class _FakeAsyncClient:
    def __init__(self) -> None:
        self.docs: dict[str, _FakeAsyncDocRef] = {}
        self.collections: dict[str, _FakeAsyncCollRef] = {}

    def document(self, path: str) -> _FakeAsyncDocRef:
        return self.docs[path]

    def collection(self, path: str) -> _FakeAsyncCollRef:
        return self.collections[path]


@pytest.fixture
def fake_firestore_module(monkeypatch: pytest.MonkeyPatch) -> _FakeAsyncClient:
    """Patch `google.cloud.firestore.AsyncClient` to our fake."""
    client = _FakeAsyncClient()

    class _ModShim:
        @staticmethod
        def AsyncClient() -> _FakeAsyncClient:
            return client

    import sys

    monkeypatch.setitem(sys.modules, "google.cloud.firestore", _ModShim)
    return client


def test_doc_get_bridges_to_dict_to_data(fake_firestore_module: _FakeAsyncClient) -> None:
    """The PR #56 regression: real adapter must return snapshots that
    expose `.data()` and `.exists`, even though google-cloud-firestore
    only ships `.to_dict()` and `.exists`."""
    fake_firestore_module.docs["apps/lifecoach/users/u1/sessions/s1"] = _FakeAsyncDocRef(
        _FakeAsyncDocSnap({"id": "s1", "userId": "u1", "events": []})
    )

    from lifecoach_agent.main import _build_real_firestore

    fs = _build_real_firestore()

    async def go() -> Any:
        snap = await fs.doc("apps/lifecoach/users/u1/sessions/s1").get()
        assert snap.exists is True
        return snap.data()

    out = asyncio.run(go())
    assert out == {"id": "s1", "userId": "u1", "events": []}


def test_collection_get_bridges_to_docs(fake_firestore_module: _FakeAsyncClient) -> None:
    """Collection.get() in google-cloud-firestore returns a list, but
    storage code iterates `snap.docs`; bridge must wrap it."""
    fake_firestore_module.collections["apps/lifecoach/users/u1/sessions"] = _FakeAsyncCollRef(
        [
            _FakeAsyncDocSnap({"id": "s1"}),
            _FakeAsyncDocSnap({"id": "s2"}),
        ]
    )

    from lifecoach_agent.main import _build_real_firestore

    fs = _build_real_firestore()

    async def go() -> list[dict[str, Any] | None]:
        snap = await fs.collection("apps/lifecoach/users/u1/sessions").get()
        return [d.data() for d in snap.docs]

    rows = asyncio.run(go())
    assert rows == [{"id": "s1"}, {"id": "s2"}]


def test_doc_get_handles_missing_doc(fake_firestore_module: _FakeAsyncClient) -> None:
    fake_firestore_module.docs["apps/lifecoach/users/u1/sessions/missing"] = _FakeAsyncDocRef(
        _FakeAsyncDocSnap(None)
    )

    from lifecoach_agent.main import _build_real_firestore

    fs = _build_real_firestore()

    async def go() -> tuple[bool, Any]:
        snap = await fs.doc("apps/lifecoach/users/u1/sessions/missing").get()
        return (snap.exists, snap.data())

    exists, data = asyncio.run(go())
    assert exists is False
    assert data is None
