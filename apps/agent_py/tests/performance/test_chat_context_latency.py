from __future__ import annotations

import time
from collections.abc import AsyncIterator
from contextlib import redirect_stdout
from dataclasses import dataclass
from io import StringIO
from typing import Any

import pytest
from tests.unit.test_server import FakeRunner, _client, _drain, _make_app, _model_text


class _SlowWeather:
    def __init__(self, delay_s: float) -> None:
        self.delay_s = delay_s

    async def get(self, _coord: Any) -> dict[str, str]:
        import asyncio

        await asyncio.sleep(self.delay_s)
        return {"condition": "too late"}


@dataclass
class _DispatchRecordingRunner(FakeRunner):
    dispatched_at: float | None = None

    def run_async(self, **kwargs: Any) -> AsyncIterator[dict[str, Any]]:
        self.dispatched_at = time.perf_counter()
        return super().run_async(**kwargs)


def _percentile(samples: list[float], percentile: float) -> float:
    ordered = sorted(samples)
    index = max(0, min(len(ordered) - 1, round((len(ordered) - 1) * percentile)))
    return ordered[index]


async def _measure_dispatch_latency(*, samples: int, provider_delay_s: float) -> list[float]:
    latencies: list[float] = []
    for sample in range(samples):
        runner = _DispatchRecordingRunner(events_per_call=[[_model_text(f"sample {sample}")]])
        app = _make_app(
            runner=runner,
            deps_overrides={"weather": _SlowWeather(provider_delay_s)},
        )
        started = time.perf_counter()
        with redirect_stdout(StringIO()):
            async with (
                _client(app) as client,
                client.stream(
                    "POST",
                    "/chat",
                    json={
                        "userId": "perf-user",
                        "sessionId": f"perf-session-{sample}",
                        "message": "hello",
                        "location": {"lat": 51.5, "lng": -0.1},
                    },
                ) as response,
            ):
                await _drain(response)
        assert runner.dispatched_at is not None
        latencies.append(runner.dispatched_at - started)
    return latencies


@pytest.mark.performance
@pytest.mark.asyncio
async def test_stalled_context_dispatch_latency_p95() -> None:
    """A one-second optional source must not delay model dispatch past the SLO."""
    samples = await _measure_dispatch_latency(samples=7, provider_delay_s=1.0)
    median_s = _percentile(samples, 0.5)
    p95_s = _percentile(samples, 0.95)

    print(
        "chat context dispatch benchmark: "
        f"n={len(samples)} median={median_s * 1000:.1f}ms p95={p95_s * 1000:.1f}ms"
    )
    assert median_s < 0.5
    assert p95_s < 0.55
