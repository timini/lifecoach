"""Firestore surface the background subsystem needs (ADR 0001).

The existing `FirestoreLike` in `firestore_session` only covers
single-doc `doc()` + whole-collection `collection().get()`. Background
dispatch needs two things it can't express:

- a **bounded due-query** (`where(...).order_by(nextRunAt).limit(N)`) so a
  post-outage backlog can't exceed the Cloud Run request deadline; and
- a **transaction** for the lease-claim primitive (read-then-conditional-
  write in one atomic step), which is the required dedupe layer — Cloud
  Tasks task-ID uniqueness is only a second layer.

Rather than widen the general protocol, this module defines a small,
self-contained surface (`BackgroundFirestore`) used only by the schedule /
run stores. It maps cleanly onto `google.cloud.firestore.AsyncClient`
(query → `collection().where().order_by().limit().get()`; `run_transaction`
→ `@async_transactional`) and onto an in-memory fake in tests.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any, Protocol, TypeVar

T = TypeVar("T")

# A Firestore filter as (field, op, value), e.g. ("enabled", "==", True).
QueryFilter = tuple[str, str, Any]


class _DeleteField:
    """Sentinel value for an `update()` patch that *removes* a field rather
    than writing null. Optional contract fields (e.g. `leaseExpiresAt`) are
    omit-only, not nullable — writing Firestore `null` would fail the web
    parser — so terminal writes delete the field instead. The real adapter
    maps this to ``google.cloud.firestore.DELETE_FIELD``; the in-memory fake
    pops the key."""

    _instance: _DeleteField | None = None

    def __new__(cls) -> _DeleteField:
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return "<DELETE_FIELD>"


DELETE_FIELD = _DeleteField()


class BgSnapshot(Protocol):
    """A document snapshot. Unlike the session Protocol this also exposes
    the document `id`, which query results need (the due-query returns docs
    the caller hasn't addressed by path)."""

    @property
    def exists(self) -> bool: ...

    @property
    def id(self) -> str: ...

    def data(self) -> dict[str, Any] | None: ...


class BgTransaction(Protocol):
    """Reads + buffered writes inside one atomic transaction. Per Firestore
    semantics all reads must precede writes; the lease-claim helpers honour
    that ordering."""

    async def get(self, path: str) -> BgSnapshot: ...

    def set(self, path: str, value: dict[str, Any]) -> None: ...

    def update(self, path: str, value: dict[str, Any]) -> None: ...


class BackgroundFirestore(Protocol):
    async def get(self, path: str) -> BgSnapshot: ...

    async def set(self, path: str, value: dict[str, Any]) -> None: ...

    async def delete(self, path: str) -> None: ...

    async def query(
        self,
        collection: str,
        *,
        filters: list[QueryFilter],
        order_by: str,
        limit: int,
    ) -> list[BgSnapshot]: ...

    async def run_transaction(self, fn: Callable[[BgTransaction], Awaitable[T]]) -> T: ...
