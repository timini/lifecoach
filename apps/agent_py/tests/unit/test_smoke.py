"""Phase 0 smoke test: the package imports and exposes a root agent."""

from lifecoach_agent import root_agent
from lifecoach_agent.agent import build_root_agent


def test_root_agent_is_built() -> None:
    assert root_agent is not None
    # Agent name is on the SSE wire as `author`; the FE only renders
    # text events whose author == "lifecoach" (apps/web/src/lib/sse.ts).
    assert root_agent.name == "lifecoach"


def test_build_root_agent_is_idempotent_in_shape() -> None:
    a = build_root_agent()
    b = build_root_agent()
    assert a.name == b.name
    assert a.model == b.model
