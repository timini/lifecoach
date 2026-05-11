"""Smoke tests for the memory client surface."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import pytest

from lifecoach_agent.context.memory import (
    Memory,
    VertexMemoryClient,
    noop_memory_client,
)


@pytest.mark.asyncio
async def test_noop_search_returns_empty() -> None:
    client = noop_memory_client()
    assert await client.search("u1", "anything", 5) == []


@pytest.mark.asyncio
async def test_noop_save_does_not_raise() -> None:
    client = noop_memory_client()
    await client.save("u1", "some text")  # no exception → pass


@dataclass
class _FakeMemory:
    text: str


class _FakeService:
    def __init__(self) -> None:
        self.added: list[Any] = []

    async def search_memory(self, *, app_name: str, user_id: str, query: str) -> Any:
        return type(
            "Resp", (), {"memories": [_FakeMemory("found one"), _FakeMemory("found two")]}
        )()

    async def add_session_to_memory(self, session: Any) -> None:
        self.added.append(session)


@pytest.mark.asyncio
async def test_vertex_memory_search_extracts_text_and_caps_at_limit() -> None:
    svc = _FakeService()
    client = VertexMemoryClient(service=svc, app_name="lifecoach")
    out = await client.search("u1", "query", limit=1)
    assert out == [Memory(text="found one")]


@pytest.mark.asyncio
async def test_vertex_memory_search_swallows_exceptions() -> None:
    class _Boom:
        async def search_memory(self, **_kw: Any) -> Any:
            raise RuntimeError("upstream is down")

        async def add_session_to_memory(self, _s: Any) -> None:
            return None

    client = VertexMemoryClient(service=_Boom(), app_name="lifecoach")
    assert await client.search("u1", "q", 5) == []


@pytest.mark.asyncio
async def test_vertex_memory_save_calls_add_session() -> None:
    svc = _FakeService()
    client = VertexMemoryClient(service=svc, app_name="lifecoach")
    await client.save("u1", "remembered fact")
    assert len(svc.added) == 1


@pytest.mark.asyncio
async def test_vertex_memory_save_swallows_exceptions() -> None:
    class _Boom:
        async def search_memory(self, **_kw: Any) -> Any:
            return None

        async def add_session_to_memory(self, _s: Any) -> None:
            raise RuntimeError("write fail")

    client = VertexMemoryClient(service=_Boom(), app_name="lifecoach")
    await client.save("u1", "x")  # no exception → pass
