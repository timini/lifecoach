"""In-memory fake for the `BackgroundFirestore` surface.

Single-threaded asyncio makes a buffered-commit transaction atomic for
our purposes: reads see committed state, writes are buffered and applied
only if the callback returns without raising. Tests simulate lease
contention by pre-seeding `pendingRunId` + a future `leaseExpiresAt`
rather than racing real coroutines.
"""

from __future__ import annotations

import operator
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, TypeVar

T = TypeVar("T")

_OPS = {
    "==": operator.eq,
    "<": operator.lt,
    "<=": operator.le,
    ">": operator.gt,
    ">=": operator.ge,
}


@dataclass
class _Snapshot:
    _id: str
    _data: dict[str, Any] | None

    @property
    def exists(self) -> bool:
        return self._data is not None

    @property
    def id(self) -> str:
        return self._id

    def data(self) -> dict[str, Any] | None:
        return None if self._data is None else dict(self._data)


def _id_of(path: str) -> str:
    return path.rsplit("/", 1)[-1]


class _Txn:
    def __init__(self, store: dict[str, dict[str, Any]]) -> None:
        self._store = store
        self._writes: list[tuple[str, dict[str, Any], bool]] = []  # (path, value, is_update)

    async def get(self, path: str) -> _Snapshot:
        data = self._store.get(path)
        return _Snapshot(_id_of(path), dict(data) if data is not None else None)

    def set(self, path: str, value: dict[str, Any]) -> None:
        self._writes.append((path, dict(value), False))

    def update(self, path: str, value: dict[str, Any]) -> None:
        self._writes.append((path, dict(value), True))

    def _commit(self) -> None:
        for path, value, is_update in self._writes:
            if is_update and path in self._store:
                self._store[path] = {**self._store[path], **value}
            else:
                self._store[path] = dict(value)


@dataclass
class FakeBackgroundFirestore:
    docs: dict[str, dict[str, Any]] = field(default_factory=dict)

    async def get(self, path: str) -> _Snapshot:
        data = self.docs.get(path)
        return _Snapshot(_id_of(path), dict(data) if data is not None else None)

    async def set(self, path: str, value: dict[str, Any]) -> None:
        self.docs[path] = dict(value)

    async def delete(self, path: str) -> None:
        self.docs.pop(path, None)

    async def query(
        self,
        collection: str,
        *,
        filters: list[tuple[str, str, Any]],
        order_by: str,
        limit: int,
    ) -> list[_Snapshot]:
        prefix = collection + "/"
        rows: list[tuple[str, dict[str, Any]]] = []
        for path, data in self.docs.items():
            if not path.startswith(prefix) or "/" in path[len(prefix) :]:
                continue
            if all(self._matches(data, f) for f in filters):
                rows.append((path, data))
        rows.sort(key=lambda kv: kv[1].get(order_by))
        return [_Snapshot(_id_of(p), dict(d)) for p, d in rows[:limit]]

    @staticmethod
    def _matches(data: dict[str, Any], flt: tuple[str, str, Any]) -> bool:
        field_name, op, value = flt
        if field_name not in data:
            return False
        return bool(_OPS[op](data[field_name], value))

    async def run_transaction(self, fn: Callable[[_Txn], Awaitable[T]]) -> T:
        txn = _Txn(self.docs)
        result = await fn(txn)
        txn._commit()
        return result
