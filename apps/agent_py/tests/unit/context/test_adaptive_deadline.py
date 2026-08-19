from __future__ import annotations

import pytest

from lifecoach_agent.context.adaptive_deadline import AdaptiveContextDeadlinePolicy


def test_starts_with_source_value_based_budgets() -> None:
    policy = AdaptiveContextDeadlinePolicy()

    assert policy.timeout_s("weather") == 0.4
    assert policy.timeout_s("profile") == 0.8


def test_tightens_after_consistently_fast_successes() -> None:
    policy = AdaptiveContextDeadlinePolicy()
    for elapsed_ms in (48, 50, 52, 49, 51):
        policy.observe_success("weather", elapsed_ms)

    assert policy.timeout_s("weather") == pytest.approx(0.2)


def test_respects_source_ceiling_after_slow_successes() -> None:
    policy = AdaptiveContextDeadlinePolicy()
    for _ in range(5):
        policy.observe_success("profile", 900)

    assert policy.timeout_s("profile") == pytest.approx(1.2)


def test_rejects_empty_window() -> None:
    with pytest.raises(ValueError, match="window_size"):
        AdaptiveContextDeadlinePolicy(window_size=0)
