"""Production `BackgroundFirestore` over `google.cloud.firestore.AsyncClient`.

Maps the small `BackgroundFirestore` surface (ADR 0001) onto the async
Firestore client: `query` → `collection().where(FieldFilter).order_by().limit()`,
`run_transaction` → `@firestore.async_transactional`. The in-memory fake in
`tests/unit/storage/_bg_firestore.py` mirrors the same surface for unit tests,
so the stores never see which implementation they're bound to.

The low-level `client`, `document`-ref builder, and `transactional` decorator
are injected (with real defaults) so the get/set/query/transaction mapping is
unit-testable without the Firestore SDK.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any, TypeVar

from lifecoach_agent.storage.background_firestore import (
    BackgroundFirestore,
    BgSnapshot,
    BgTransaction,
    QueryFilter,
    _DeleteField,
)

T = TypeVar("T")


class _SnapAdapter:
    def __init__(self, snap: Any) -> None:
        self._snap = snap

    @property
    def exists(self) -> bool:
        return bool(self._snap.exists)

    @property
    def id(self) -> str:
        return str(self._snap.id)

    def data(self) -> dict[str, Any] | None:
        d = self._snap.to_dict()
        return None if d is None else dict(d)


def _map_delete_fields(value: dict[str, Any], delete_sentinel: Any) -> dict[str, Any]:
    return {k: (delete_sentinel if isinstance(v, _DeleteField) else v) for k, v in value.items()}


class _TxnAdapter:
    def __init__(self, *, client: Any, txn: Any, delete_sentinel: Any) -> None:
        self._client = client
        self._txn = txn
        self._delete_sentinel = delete_sentinel

    async def get(self, path: str) -> BgSnapshot:
        snap = await self._client.document(path).get(transaction=self._txn)
        return _SnapAdapter(snap)

    def set(self, path: str, value: dict[str, Any]) -> None:
        self._txn.set(self._client.document(path), value)

    def update(self, path: str, value: dict[str, Any]) -> None:
        self._txn.update(
            self._client.document(path), _map_delete_fields(value, self._delete_sentinel)
        )


class FirestoreBackgroundAdapter:
    def __init__(
        self,
        *,
        client: Any,
        field_filter: Callable[[str, str, Any], Any],
        transactional: Callable[[Any], Any],
        delete_sentinel: Any,
    ) -> None:
        self._client = client
        self._field_filter = field_filter
        self._transactional = transactional
        self._delete_sentinel = delete_sentinel

    async def get(self, path: str) -> BgSnapshot:
        return _SnapAdapter(await self._client.document(path).get())

    async def set(self, path: str, value: dict[str, Any]) -> None:
        await self._client.document(path).set(value)

    async def delete(self, path: str) -> None:
        await self._client.document(path).delete()

    async def query(
        self,
        collection: str,
        *,
        filters: list[QueryFilter],
        order_by: str,
        limit: int,
    ) -> list[BgSnapshot]:
        q = self._client.collection(collection)
        for field, op, val in filters:
            q = q.where(filter=self._field_filter(field, op, val))
        q = q.order_by(order_by).limit(limit)
        snaps = await q.get()
        return [_SnapAdapter(s) for s in snaps]

    async def run_transaction(self, fn: Callable[[BgTransaction], Awaitable[T]]) -> T:
        transaction = self._client.transaction()

        @self._transactional
        async def _wrapped(txn: Any) -> T:
            return await fn(
                _TxnAdapter(client=self._client, txn=txn, delete_sentinel=self._delete_sentinel)
            )

        result: T = await _wrapped(transaction)
        return result


def create_background_firestore() -> BackgroundFirestore:
    """Build the real adapter over a fresh `firestore.AsyncClient`."""
    from google.cloud import firestore

    return FirestoreBackgroundAdapter(
        client=firestore.AsyncClient(),
        field_filter=firestore.FieldFilter,
        transactional=firestore.async_transactional,
        delete_sentinel=firestore.DELETE_FIELD,
    )
