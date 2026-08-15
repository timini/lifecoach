"""Bound optional chat-context work without failing the foreground turn."""

from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable
from dataclasses import dataclass
from typing import Literal

ContextOutcome = Literal["ok", "timeout", "error"]


@dataclass(frozen=True)
class ContextResult[T]:
    value: T
    elapsed_ms: int
    outcome: ContextOutcome


async def bounded_context[T](
    awaitable: Awaitable[T],
    *,
    fallback: T,
    timeout_s: float,
) -> ContextResult[T]:
    """Await optional context with an independent deadline and safe fallback."""
    started = time.monotonic()
    try:
        value = await asyncio.wait_for(awaitable, timeout=timeout_s)
        outcome: ContextOutcome = "ok"
    except TimeoutError:
        value = fallback
        outcome = "timeout"
    except Exception:  # noqa: BLE001 - optional context must degrade independently
        value = fallback
        outcome = "error"
    elapsed_ms = round((time.monotonic() - started) * 1000)
    return ContextResult(value=value, elapsed_ms=elapsed_ms, outcome=outcome)
