"""Background workflow contract (ADR 0001 §5, step 5b-ii).

Background execution does NOT post a synthetic message to `/chat`; it runs an
explicit, non-interactive workflow whose semantics are visible in code. A
workflow receives a `BackgroundRunContext` (built server-side by the runner —
schedule, run record, and a valid Workspace access token) and returns a
`BackgroundRunResult` (a digest + proposed actions). Per project invariant #2,
any model context is injected as prompt text by the workflow, never read via a
tool; per ADR §Decision, a workflow never mutates third-party state — it only
*proposes* actions for later foreground confirmation.

`BackgroundRetryableError` is the one signal a workflow uses to ask for a Cloud
Tasks retry (transient infra/network). Any other exception is treated by the
runner as a non-retryable (terminal) failure.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

from lifecoach_agent.contracts.background import (
    BackgroundNotification,
    BackgroundProposedAction,
    BackgroundRun,
    BackgroundSchedule,
)


class BackgroundRetryableError(Exception):
    """Raise from a workflow to request a Cloud Tasks retry (transient infra,
    Firestore, Gmail, Vertex, or network failure within bounded attempts). The
    runner maps it to `retryable_failed` + a 5xx response. `error_code` must be
    a stable sanitized code — never raw third-party text."""

    def __init__(self, error_code: str) -> None:
        super().__init__(error_code)
        self.error_code = error_code


@dataclass(frozen=True)
class BackgroundRunContext:
    """Server-built inputs for one workflow run. The access token stays in
    process — it is never logged, prompted, or returned to the client."""

    run: BackgroundRun
    schedule: BackgroundSchedule
    workspace_access_token: str
    now_iso: str


@dataclass(frozen=True)
class BackgroundRunResult:
    """Structured output of a workflow. The runner persists the notification +
    proposed actions and records `model`/`tokenCostEstimate` on the run."""

    notification: BackgroundNotification | None = None
    proposed_actions: list[BackgroundProposedAction] = field(default_factory=list)
    model: str | None = None
    token_cost_estimate: float | None = None


class BackgroundWorkflow(Protocol):
    name: str

    async def run(self, ctx: BackgroundRunContext) -> BackgroundRunResult: ...
