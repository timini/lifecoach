"""Adaptive optional-context deadlines based on recent successful latency."""

from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import dataclass


@dataclass(frozen=True)
class DeadlineBounds:
    initial_s: float
    floor_s: float
    ceiling_s: float


_ENRICHMENT = DeadlineBounds(initial_s=0.4, floor_s=0.2, ceiling_s=0.6)
_CONTINUITY = DeadlineBounds(initial_s=0.8, floor_s=0.3, ceiling_s=1.2)
_BOUNDS = {
    "weather": _ENRICHMENT,
    "places": _ENRICHMENT,
    "air_quality": _ENRICHMENT,
    "holidays": _ENRICHMENT,
    "calendar_density": DeadlineBounds(initial_s=0.6, floor_s=0.3, ceiling_s=0.9),
    "profile": _CONTINUITY,
    "goals": _CONTINUITY,
    "memory": _CONTINUITY,
    "existing_session": _CONTINUITY,
    "yesterday_summary": _CONTINUITY,
    "week_summary": _CONTINUITY,
}


class AdaptiveContextDeadlinePolicy:
    """Keep a small process-local latency window; no payloads or user IDs."""

    def __init__(self, *, window_size: int = 32) -> None:
        if window_size < 1:
            raise ValueError("window_size must be positive")
        self._samples_ms: dict[str, deque[int]] = defaultdict(lambda: deque(maxlen=window_size))

    def timeout_s(self, source: str) -> float:
        bounds = _BOUNDS[source]
        samples = self._samples_ms[source]
        if not samples:
            return bounds.initial_s
        ordered = sorted(samples)
        p90_ms = ordered[round((len(ordered) - 1) * 0.9)]
        learned_s = p90_ms / 1000 * 2 + 0.05
        return max(bounds.floor_s, min(bounds.ceiling_s, learned_s))

    def observe_success(self, source: str, elapsed_ms: int) -> None:
        self._samples_ms[source].append(max(0, elapsed_ms))
