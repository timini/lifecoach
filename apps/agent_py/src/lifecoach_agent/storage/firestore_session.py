"""Firestore-backed Session storage.

Mirrors `apps/agent/src/storage/firestoreSession.ts`. Session docs live
at `apps/{app_name}/users/{user_id}/sessions/{session_id}` and hold the
full ADK `state` + `events` array. This module exposes:

- `FirestoreLike` — a minimal Protocol covering the bits we use; tests
  inject an in-memory fake. Phase 9's server wires
  `google.cloud.firestore.AsyncClient` through a thin adapter.
- `FirestoreSessionService` — used by the ADK Runner. Injects recovery
  events on read (Phase 8 ports the empty-turn guard); the import is
  lazy so this module is callable without it.
- `save_session_summary()` — used by `context.session_summary` to
  persist the lazily-generated yesterday/week summary onto the session
  doc's `state.summary`.
"""

from __future__ import annotations

import secrets
import time
from typing import Any, Protocol


class FirestoreSnapshot(Protocol):
    @property
    def exists(self) -> bool: ...
    def data(self) -> dict[str, Any] | None: ...


class FirestoreDocLike(Protocol):
    async def get(self) -> FirestoreSnapshot: ...
    async def set(self, value: dict[str, Any], *, merge: bool = False) -> Any: ...
    async def delete(self) -> Any: ...


class FirestoreCollectionSnapshot(Protocol):
    @property
    def docs(self) -> list[FirestoreSnapshot]: ...


class FirestoreCollectionLike(Protocol):
    async def get(self) -> FirestoreCollectionSnapshot: ...


class FirestoreLike(Protocol):
    """Minimal Firestore surface the storage layer depends on."""

    def doc(self, path: str) -> FirestoreDocLike: ...
    def collection(self, path: str) -> FirestoreCollectionLike: ...


def _session_path(app_name: str, user_id: str, session_id: str) -> str:
    return f"apps/{app_name}/users/{user_id}/sessions/{session_id}"


def _collection_path(app_name: str, user_id: str) -> str:
    return f"apps/{app_name}/users/{user_id}/sessions"


def _generate_session_id() -> str:
    return f"s-{secrets.token_hex(6)}"


class FirestoreSessionService:
    """Minimal SessionService surface — enough for the server's
    `/chat`, `/history`, `/sessions` endpoints. Phase 9's server wires
    this into the ADK Runner.

    Note: the full ADK `BaseSessionService` subclass with `append_event`
    state-delta semantics lands when Phase 9 wires the Runner, where
    we'll align method signatures with the actual ADK API. For now this
    class exposes the data-plane surface tests need."""

    def __init__(self, fs: FirestoreLike) -> None:
        self._fs = fs

    async def create_session(
        self,
        *,
        app_name: str,
        user_id: str,
        session_id: str | None = None,
        state: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        sid = session_id or _generate_session_id()
        session: dict[str, Any] = {
            "id": sid,
            "appName": app_name,
            "userId": user_id,
            "state": state or {},
            "events": [],
            "lastUpdateTime": int(time.time() * 1000),
        }
        await self._fs.doc(_session_path(app_name, user_id, sid)).set(session)
        return session

    async def get_session(
        self,
        *,
        app_name: str,
        user_id: str,
        session_id: str,
        num_recent_events: int | None = None,
        after_timestamp: int | None = None,
    ) -> dict[str, Any] | None:
        snap = await self._fs.doc(_session_path(app_name, user_id, session_id)).get()
        if not snap.exists:
            return None
        stored = snap.data()
        if not stored:
            return None
        events: list[dict[str, Any]] = list(stored.get("events", []))
        if num_recent_events and num_recent_events > 0:
            events = events[-num_recent_events:]
        if after_timestamp is not None:
            events = [e for e in events if (e.get("timestamp") or 0) > after_timestamp]
        # Phase 8 will splice synthetic recovery events here. Until then,
        # pass through unmodified.
        try:
            from lifecoach_agent.chat.empty_turn_guard import (  # type: ignore[import-not-found,import-untyped]
                inject_recovery_events,
            )

            events = inject_recovery_events(events)
        except ImportError:
            pass
        out = dict(stored)
        out["events"] = events
        return out

    async def list_sessions(self, *, app_name: str, user_id: str) -> list[dict[str, Any]]:
        snap = await self._fs.collection(_collection_path(app_name, user_id)).get()
        sessions: list[dict[str, Any]] = []
        for d in snap.docs:
            data = d.data() or {}
            # Contract: list does not populate events/state.
            sessions.append(
                {
                    "id": data.get("id"),
                    "appName": data.get("appName"),
                    "userId": data.get("userId"),
                    "state": {},
                    "events": [],
                    "lastUpdateTime": data.get("lastUpdateTime", 0),
                }
            )
        return sessions

    async def delete_session(self, *, app_name: str, user_id: str, session_id: str) -> None:
        await self._fs.doc(_session_path(app_name, user_id, session_id)).delete()

    async def append_event(
        self, *, session: dict[str, Any], event: dict[str, Any]
    ) -> dict[str, Any]:
        # Persist a full session write per event. Simple; scales fine for
        # chat-length sessions (Firestore docs cap at 1 MiB; ~100 turns
        # × ~2 KiB = 200 KiB).
        events = list(session.get("events", []))
        events.append(event)
        session["events"] = events
        session["lastUpdateTime"] = int(time.time() * 1000)
        await self._fs.doc(_session_path(session["appName"], session["userId"], session["id"])).set(
            session
        )
        return event


def create_firestore_session_service(*, firestore: FirestoreLike) -> FirestoreSessionService:
    return FirestoreSessionService(firestore)


async def save_session_summary(
    *,
    firestore: FirestoreLike,
    app_name: str,
    user_id: str,
    session_id: str,
    summary: str,
    generated_at: int,
) -> None:
    """Persist `state.summary` + `state.summaryGeneratedAt` on the
    session doc. Merge so we don't clobber other state fields the ADK
    base service has written."""
    await firestore.doc(_session_path(app_name, user_id, session_id)).set(
        {"state": {"summary": summary, "summaryGeneratedAt": generated_at}},
        merge=True,
    )
