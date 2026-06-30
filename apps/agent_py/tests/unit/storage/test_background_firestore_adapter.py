"""Unit tests for the production BackgroundFirestore adapter (ADR 0001 step 5a).

Drives `FirestoreBackgroundAdapter` against a minimal in-memory fake of the
`google.cloud.firestore.AsyncClient` surface, so the get/set/delete/query and
transaction mapping (incl. DELETE_FIELD) are exercised without the SDK.
"""

from __future__ import annotations

from typing import Any

import pytest

from lifecoach_agent.storage.background_firestore import DELETE_FIELD
from lifecoach_agent.storage.background_firestore_adapter import (
    FirestoreBackgroundAdapter,
    _TxnAdapter,
)

pytestmark = pytest.mark.asyncio

_DELETE_SENTINEL = object()


class _FakeSnap:
    def __init__(self, doc_id: str, data: dict[str, Any] | None) -> None:
        self.id = doc_id
        self._data = data

    @property
    def exists(self) -> bool:
        return self._data is not None

    def to_dict(self) -> dict[str, Any] | None:
        return None if self._data is None else dict(self._data)


class _FakeDocRef:
    def __init__(self, store: dict[str, dict[str, Any]], path: str) -> None:
        self._store = store
        self._path = path

    @property
    def _id(self) -> str:
        return self._path.rsplit("/", 1)[-1]

    async def get(self, transaction: Any = None) -> _FakeSnap:
        data = self._store.get(self._path)
        return _FakeSnap(self._id, dict(data) if data is not None else None)

    async def set(self, value: dict[str, Any]) -> None:
        self._store[self._path] = dict(value)

    async def delete(self) -> None:
        self._store.pop(self._path, None)


class _FakeQuery:
    def __init__(self, store: dict[str, dict[str, Any]], collection: str) -> None:
        self._store = store
        self._collection = collection
        self._filters: list[tuple[str, str, Any]] = []
        self._order_by: str | None = None
        self._limit: int | None = None

    def where(self, *, filter: tuple[str, str, Any]) -> _FakeQuery:  # noqa: A002
        self._filters.append(filter)
        return self

    def order_by(self, field: str) -> _FakeQuery:
        self._order_by = field
        return self

    def limit(self, n: int) -> _FakeQuery:
        self._limit = n
        return self

    async def get(self) -> list[_FakeSnap]:
        import operator

        ops = {"==": operator.eq, "<=": operator.le}
        prefix = self._collection + "/"
        rows = [
            (p, d)
            for p, d in self._store.items()
            if p.startswith(prefix) and "/" not in p[len(prefix) :]
        ]
        for f, op, v in self._filters:
            rows = [(p, d) for p, d in rows if f in d and ops[op](d[f], v)]
        if self._order_by is not None:
            rows.sort(key=lambda kv: kv[1].get(self._order_by))
        if self._limit is not None:
            rows = rows[: self._limit]
        return [_FakeSnap(p.rsplit("/", 1)[-1], dict(d)) for p, d in rows]


class _FakeTxn:
    def __init__(self, store: dict[str, dict[str, Any]]) -> None:
        self._store = store

    def set(self, doc_ref: _FakeDocRef, value: dict[str, Any]) -> None:
        doc_ref._store[doc_ref._path] = dict(value)

    def update(self, doc_ref: _FakeDocRef, value: dict[str, Any]) -> None:
        merged = {**doc_ref._store.get(doc_ref._path, {}), **value}
        doc_ref._store[doc_ref._path] = {
            k: v for k, v in merged.items() if v is not _DELETE_SENTINEL
        }


class _FakeClient:
    def __init__(self) -> None:
        self.store: dict[str, dict[str, Any]] = {}

    def document(self, path: str) -> _FakeDocRef:
        return _FakeDocRef(self.store, path)

    def collection(self, name: str) -> _FakeQuery:
        return _FakeQuery(self.store, name)

    def transaction(self) -> _FakeTxn:
        return _FakeTxn(self.store)


def _adapter(client: _FakeClient) -> FirestoreBackgroundAdapter:
    return FirestoreBackgroundAdapter(
        client=client,
        field_filter=lambda f, op, v: (f, op, v),
        transactional=lambda fn: fn,  # no retry wrapper in tests
        delete_sentinel=_DELETE_SENTINEL,
    )


async def test_set_get_round_trip_and_missing() -> None:
    client = _FakeClient()
    adapter = _adapter(client)
    await adapter.set("backgroundRuns/r1", {"status": "queued"})
    snap = await adapter.get("backgroundRuns/r1")
    assert snap.exists and snap.id == "r1" and snap.data() == {"status": "queued"}

    missing = await adapter.get("backgroundRuns/none")
    assert not missing.exists and missing.data() is None


async def test_delete() -> None:
    client = _FakeClient()
    adapter = _adapter(client)
    await adapter.set("backgroundRuns/r1", {"status": "queued"})
    await adapter.delete("backgroundRuns/r1")
    assert not (await adapter.get("backgroundRuns/r1")).exists


async def test_query_filters_orders_and_limits() -> None:
    client = _FakeClient()
    adapter = _adapter(client)
    client.store["backgroundSchedules/a"] = {
        "enabled": True,
        "nextRunAt": "2026-05-15T08:00:00.000Z",
    }
    client.store["backgroundSchedules/b"] = {
        "enabled": True,
        "nextRunAt": "2026-05-15T07:00:00.000Z",
    }
    client.store["backgroundSchedules/c"] = {
        "enabled": False,
        "nextRunAt": "2026-05-15T06:00:00.000Z",
    }
    client.store["other/x"] = {"enabled": True, "nextRunAt": "2026-05-15T05:00:00.000Z"}

    snaps = await adapter.query(
        "backgroundSchedules",
        filters=[("enabled", "==", True), ("nextRunAt", "<=", "2026-05-15T09:00:00.000Z")],
        order_by="nextRunAt",
        limit=10,
    )
    # b (07:00) before a (08:00); c excluded (disabled); other/x excluded.
    assert [s.id for s in snaps] == ["b", "a"]


async def test_transaction_get_set_and_delete_field() -> None:
    client = _FakeClient()
    adapter = _adapter(client)
    client.store["backgroundSchedules/s1"] = {
        "enabled": True,
        "pendingRunId": "r1",
        "leaseExpiresAt": "2026-05-15T09:05:00.000Z",
    }

    async def _txn(txn: _TxnAdapter) -> bool:
        snap = await txn.get("backgroundSchedules/s1")
        assert snap.exists
        # Update clears the lease via DELETE_FIELD + advances a field.
        txn.update(
            "backgroundSchedules/s1",
            {"pendingRunId": DELETE_FIELD, "leaseExpiresAt": DELETE_FIELD, "nextRunAt": "next"},
        )
        return True

    assert await adapter.run_transaction(_txn) is True
    doc = client.store["backgroundSchedules/s1"]
    assert "pendingRunId" not in doc
    assert "leaseExpiresAt" not in doc
    assert doc["nextRunAt"] == "next"


async def test_transaction_set_writes_full_doc() -> None:
    client = _FakeClient()
    adapter = _adapter(client)

    async def _txn(txn: _TxnAdapter) -> None:
        txn.set("backgroundRuns/r1", {"status": "queued"})

    await adapter.run_transaction(_txn)
    assert client.store["backgroundRuns/r1"] == {"status": "queued"}
