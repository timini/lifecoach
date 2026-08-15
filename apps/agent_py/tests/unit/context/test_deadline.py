from __future__ import annotations

import asyncio

import pytest

from lifecoach_agent.context.deadline import bounded_context


@pytest.mark.asyncio
async def test_returns_value_and_ok_outcome() -> None:
    async def source() -> str:
        return "fresh"

    result = await bounded_context(source(), fallback="stale", timeout_s=0.1)

    assert result.value == "fresh"
    assert result.outcome == "ok"


@pytest.mark.asyncio
async def test_times_out_only_the_slow_source() -> None:
    cancelled = asyncio.Event()

    async def source() -> str:
        try:
            await asyncio.sleep(1)
        finally:
            cancelled.set()
        return "late"

    result = await bounded_context(source(), fallback="default", timeout_s=0.001)

    assert result.value == "default"
    assert result.outcome == "timeout"
    assert cancelled.is_set()


@pytest.mark.asyncio
async def test_converts_source_error_to_fallback() -> None:
    async def source() -> list[str]:
        raise RuntimeError("provider unavailable")

    result = await bounded_context(source(), fallback=[], timeout_s=0.1)

    assert result.value == []
    assert result.outcome == "error"
