"""Minimal Sentry wrapper. Mirrors `apps/agent/src/sentry.ts`.

`init_sentry()` is idempotent and a no-op when `SENTRY_DSN` is unset
(local dev, preview deploys without telemetry). `capture_chat_event`
records non-error chat-pipeline events; safe to call before init — it
also no-ops without a DSN.

Kept in its own module so the server doesn't have to take a hard
dependency on sentry-sdk at import time when Sentry isn't configured.
"""

from __future__ import annotations

import os
from typing import Any

_initialised = False


def _dsn() -> str | None:
    return os.environ.get("SENTRY_DSN") or None


def init_sentry() -> None:
    """Initialise Sentry. No-op without DSN; idempotent across cold starts."""
    global _initialised
    if _initialised:
        return
    dsn = _dsn()
    if not dsn:
        return
    try:
        import sentry_sdk
    except ImportError:
        return
    sentry_sdk.init(
        dsn=dsn,
        environment=os.environ.get("SENTRY_ENVIRONMENT", "unknown"),
        release=os.environ.get("SENTRY_RELEASE"),
        traces_sample_rate=0.05,
        send_default_pii=False,
    )
    _initialised = True


SentryLevel = Any  # Literal levels accepted by sentry_sdk; kept open for flex.


def capture_chat_event(
    message: str,
    context: dict[str, Any],
    level: SentryLevel = "warning",
) -> None:
    """Record a non-error chat-pipeline event with structured context.
    No-ops without a DSN so call sites can fire-and-forget."""
    if not _dsn():
        return
    try:
        import sentry_sdk
    except ImportError:
        return
    with sentry_sdk.push_scope() as scope:
        scope.set_tag("feature", "chat")
        for k, v in context.items():
            scope.set_extra(k, v)
        sentry_sdk.capture_message(message, level=level)
