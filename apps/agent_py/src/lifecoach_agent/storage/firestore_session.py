"""Firestore-backed Session storage.

Mirrors `apps/agent/src/storage/firestoreSession.ts`. Session docs live
at `apps/{app_name}/users/{user_id}/sessions/{session_id}` and hold the
full ADK `state` + `events` array. This module exposes:

- `FirestoreLike` — a minimal Protocol covering the bits we use; tests
  inject an in-memory fake. `main.py` wires
  `google.cloud.firestore.AsyncClient` through an adapter that bridges
  the SDK's `to_dict()` snapshot accessor onto our Protocol's `data()`.
- `FirestoreSessionService` — extends ADK's `BaseSessionService` so the
  Runner can call `get_session(..., config=...)` and receive real
  `Session` objects. Injects recovery events on read via the empty-
  turn guard; the import is lazy so this module is callable without it.
- `save_session_summary()` — used by `context.session_summary` to
  persist the lazily-generated yesterday/week summary onto the session
  doc's `state.summary`.
"""

from __future__ import annotations

import logging
import secrets
import time
from typing import Any, Protocol

from google.adk.events import Event
from google.adk.sessions import Session
from google.adk.sessions.base_session_service import (
    BaseSessionService,
    GetSessionConfig,
    ListSessionsResponse,
)

logger = logging.getLogger(__name__)


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


def _to_event(d: Any) -> Event | None:
    """Best-effort dict → Event conversion. Tolerant of partial shapes
    written by older runtimes; returns None when the dict can't be
    parsed (logged but not raised — a single bad event must not poison
    history rehydration)."""
    if isinstance(d, Event):
        return d
    if not isinstance(d, dict):
        return None
    try:
        return Event.model_validate(d)
    except Exception as err:  # noqa: BLE001
        logger.warning("dropping malformed stored event: %s", err)
        return None


def _event_to_storage_dict(event: Event) -> dict[str, Any]:
    """Event → JSON-friendly dict using camelCase aliases so a roundtrip
    matches the on-disk shape the TS service has been writing."""
    return event.model_dump(mode="json", by_alias=True, exclude_none=True)


class FirestoreSessionService(BaseSessionService):
    """Firestore-backed SessionService for the ADK Runner.

    Implements `BaseSessionService` so `Runner._get_or_create_session`
    can call `get_session(..., config=...)` and receive real `Session`
    objects. Stored docs use camelCase keys (`appName`, `userId`,
    `lastUpdateTime`, events serialised via `model_dump(by_alias=True)`)
    to keep on-disk parity with the prior TS service — see issue PR #56.
    """

    def __init__(self, fs: FirestoreLike) -> None:
        self._fs = fs

    async def create_session(
        self,
        *,
        app_name: str,
        user_id: str,
        state: dict[str, Any] | None = None,
        session_id: str | None = None,
    ) -> Session:
        sid = session_id or _generate_session_id()
        now_ms = int(time.time() * 1000)
        stored: dict[str, Any] = {
            "id": sid,
            "appName": app_name,
            "userId": user_id,
            "state": state or {},
            "events": [],
            "lastUpdateTime": now_ms,
        }
        await self._fs.doc(_session_path(app_name, user_id, sid)).set(stored)
        return Session(
            id=sid,
            app_name=app_name,
            user_id=user_id,
            state=dict(state or {}),
            events=[],
            last_update_time=now_ms / 1000.0,
        )

    async def get_session(
        self,
        *,
        app_name: str,
        user_id: str,
        session_id: str,
        config: GetSessionConfig | None = None,
    ) -> Session | None:
        snap = await self._fs.doc(_session_path(app_name, user_id, session_id)).get()
        if not snap.exists:
            return None
        stored = snap.data()
        if not stored:
            return None
        raw_events: list[Any] = list(stored.get("events", []))
        if config is not None:
            if config.num_recent_events is not None and config.num_recent_events > 0:
                raw_events = raw_events[-config.num_recent_events :]
            if config.after_timestamp is not None:
                raw_events = [
                    e for e in raw_events if (e.get("timestamp") or 0) > config.after_timestamp
                ]
        # Splice synthetic recovery events for already-poisoned sessions
        # so the model never sees its own broken pattern in history.
        from lifecoach_agent.chat.empty_turn_guard import inject_recovery_events

        raw_events = inject_recovery_events(raw_events)
        events: list[Event] = []
        for d in raw_events:
            ev = _to_event(d)
            if ev is not None:
                events.append(ev)
        return Session(
            id=stored.get("id") or session_id,
            app_name=stored.get("appName") or app_name,
            user_id=stored.get("userId") or user_id,
            state=dict(stored.get("state") or {}),
            events=events,
            last_update_time=float(stored.get("lastUpdateTime") or 0) / 1000.0,
        )

    async def list_sessions(
        self, *, app_name: str, user_id: str | None = None
    ) -> ListSessionsResponse:
        if user_id is None:
            return ListSessionsResponse(sessions=[])
        snap = await self._fs.collection(_collection_path(app_name, user_id)).get()
        sessions: list[Session] = []
        for d in snap.docs:
            data = d.data() or {}
            # Contract: list does not populate events/state — the
            # endpoint just renders an index.
            sessions.append(
                Session(
                    id=str(data.get("id") or ""),
                    app_name=str(data.get("appName") or app_name),
                    user_id=str(data.get("userId") or user_id),
                    state={},
                    events=[],
                    last_update_time=float(data.get("lastUpdateTime") or 0) / 1000.0,
                )
            )
        return ListSessionsResponse(sessions=sessions)

    async def delete_session(self, *, app_name: str, user_id: str, session_id: str) -> None:
        await self._fs.doc(_session_path(app_name, user_id, session_id)).delete()

    async def append_event(self, session: Session, event: Event) -> Event:
        # The base impl applies the temp-state/state-delta semantics and
        # mutates session.events in-place. We then persist the full
        # session — simple, scales fine for chat-length sessions
        # (Firestore docs cap at 1 MiB; ~100 turns × ~2 KiB = 200 KiB).
        result = await super().append_event(session, event)
        if event.partial:
            return result
        now_ms = int(time.time() * 1000)
        session.last_update_time = now_ms / 1000.0
        stored = {
            "id": session.id,
            "appName": session.app_name,
            "userId": session.user_id,
            "state": dict(session.state),
            "events": [_event_to_storage_dict(e) for e in session.events],
            "lastUpdateTime": now_ms,
        }
        await self._fs.doc(_session_path(session.app_name, session.user_id, session.id)).set(stored)
        return result


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
