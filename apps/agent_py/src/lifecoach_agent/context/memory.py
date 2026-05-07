"""Long-term memory client.

Replaces the TS-side mem0 integration with `VertexAiMemoryBankService`
from `google-adk` 1.32. The behavioural surface is the same as the TS
`MemoryClient`:

  search(uid, query, limit) -> list[Memory]
  save(uid, text)            -> None  (best-effort, never raises)

Vertex Memory Bank is fundamentally session-oriented: writes happen
when ADK's Runner calls `add_session_to_memory(session)` at session end.
For our `memory_save(text)` tool surface (Phase 6), we synthesize a
single-event session and add it. Search uses `search_memory(query)`.

When `agent_engine_id` is unset, `noop_memory_client()` is the safe
default — no memory features activate; nothing crashes.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol


@dataclass(frozen=True)
class Memory:
    text: str


class MemoryClient(Protocol):
    async def search(self, uid: str, query: str, limit: int) -> list[Memory]: ...
    async def save(self, uid: str, text: str) -> None: ...


class _NoopClient:
    """No-op fallback used when the user hasn't provisioned an Agent
    Engine (see Terraform `infra/modules/memory-bank/`)."""

    async def search(self, uid: str, query: str, limit: int) -> list[Memory]:
        return []

    async def save(self, uid: str, text: str) -> None:
        return None


def noop_memory_client() -> MemoryClient:
    return _NoopClient()


class VertexMemoryClient:
    """Thin wrapper around `google.adk.memory.VertexAiMemoryBankService`.

    The wrapped service is held as a duck-typed object so unit tests can
    inject a fake. The expected shape:

        service.search_memory(app_name=..., user_id=..., query=...) -> Awaitable[Any]
        service.add_session_to_memory(session) -> Awaitable[None]

    Best-effort by design: any exception in `search` returns an empty
    list; any exception in `save` is swallowed so a memory failure
    never crashes a turn.
    """

    def __init__(self, *, service: Any, app_name: str = "lifecoach") -> None:
        self._service = service
        self._app_name = app_name

    async def search(self, uid: str, query: str, limit: int) -> list[Memory]:
        try:
            response = await self._service.search_memory(
                app_name=self._app_name, user_id=uid, query=query
            )
        except Exception:  # noqa: BLE001
            return []
        memories = getattr(response, "memories", None) or []
        out: list[Memory] = []
        for m in memories[:limit]:
            text = _extract_text(m)
            if text:
                out.append(Memory(text=text))
        return out

    async def save(self, uid: str, text: str) -> None:
        # Synthesize a single-event session from `text`. The actual ADK
        # Session/Event wiring happens in Phase 6 once the Runner is
        # configured; for now we leave a clear hook so the call site can
        # pass in a real session object instead.
        try:
            session = _build_synthetic_session(self._app_name, uid, text)
            await self._service.add_session_to_memory(session)
        except Exception:  # noqa: BLE001
            return None


def create_vertex_memory_client(
    *, project: str, location: str, agent_engine_id: str, app_name: str = "lifecoach"
) -> MemoryClient:
    """Production factory — returns a `VertexMemoryClient` backed by a
    real `VertexAiMemoryBankService`. Falls back to noop if the import
    fails (e.g. running in an environment without Memory Bank deps)."""
    try:
        from google.adk.memory import VertexAiMemoryBankService
    except ImportError:
        return noop_memory_client()
    service = VertexAiMemoryBankService(
        project=project, location=location, agent_engine_id=agent_engine_id
    )
    return VertexMemoryClient(service=service, app_name=app_name)


def _extract_text(memory: Any) -> str | None:
    """Pull the searchable text out of an ADK MemoryEntry. Tolerant —
    the exact shape can shift between ADK minor versions."""
    # Direct `.text` (older shape).
    direct = getattr(memory, "text", None)
    if isinstance(direct, str) and direct:
        return direct
    # `.content.parts[].text` (Event-aligned shape).
    content = getattr(memory, "content", None)
    parts = getattr(content, "parts", None) if content else None
    if parts:
        joined = "".join(p.text for p in parts if isinstance(getattr(p, "text", None), str)).strip()
        if joined:
            return joined
    return None


def _build_synthetic_session(app_name: str, uid: str, text: str) -> Any:
    """Build a minimal Session object containing one user-authored event
    with `text`. Returns whatever `google.adk.sessions.Session` resolves
    to; a tolerant duck-type so this works against fakes in tests."""
    try:
        from google.adk.events import Event
        from google.adk.sessions import Session
        from google.genai import types as genai_types
    except ImportError:
        # Tests pass a stub `service`; fall back to a minimal duck-typed object.
        return type("StubSession", (), {"app_name": app_name, "user_id": uid, "text": text})()

    event = Event(
        author="user",
        content=genai_types.Content(parts=[genai_types.Part(text=text)]),
    )
    return Session(app_name=app_name, user_id=uid, id=f"memory-save-{uid}", events=[event])
