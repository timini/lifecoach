"""Deterministic identifiers for background runs + Cloud Tasks (ADR 0001 §4).

Every id derived here is a pure function of ``(scheduleId, kind, scheduledFor)``
so a re-dispatched occurrence (after a crashed/expired lease) produces the
*same* run id, idempotency key, and task id — making run creation and task
enqueue idempotent without a shared transaction. No randomness, ever (a nonce
would defeat the dedupe the deterministic id exists for).

uids and other long/sensitive identifiers are hashed (truncated SHA-256)
before they enter a task id or a log line; raw uids never appear there.
"""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime

from lifecoach_agent.contracts.background import sanitize_task_id


def uid_hash(uid: str) -> str:
    """Truncated SHA-256 of a uid — the only form allowed in task ids + logs
    (ADR §Observability). 8 hex chars: ample collision resistance per-user."""
    return hashlib.sha256(uid.encode("utf-8")).hexdigest()[:8]


def _compact_ts(scheduled_for_iso: str) -> str:
    """`YYYYMMDDTHHMMSSZ` — the colon-free timestamp Cloud Tasks ids require."""
    dt = datetime.fromisoformat(scheduled_for_iso.replace("Z", "+00:00")).astimezone(UTC)
    return dt.strftime("%Y%m%dT%H%M%SZ")


def idempotency_key(schedule_id: str, kind: str, scheduled_for_iso: str) -> str:
    """The full audit key persisted on the run (ADR §6). Raw colons are fine
    in a Firestore field value — only the Cloud Tasks *id* must be sanitized."""
    return f"{schedule_id}:{kind}:{scheduled_for_iso}"


def _short_hash(schedule_id: str, kind: str, scheduled_for_iso: str) -> str:
    digest = hashlib.sha256(idempotency_key(schedule_id, kind, scheduled_for_iso).encode("utf-8"))
    return digest.hexdigest()[:6]


def run_id(schedule_id: str, kind: str, scheduled_for_iso: str) -> str:
    """`run_{YYYYMMDDTHHMMSSZ}_{shortHash}` — deterministic per occurrence."""
    return (
        f"run_{_compact_ts(scheduled_for_iso)}_{_short_hash(schedule_id, kind, scheduled_for_iso)}"
    )


def task_id(schedule_id: str, kind: str, uid: str, scheduled_for_iso: str) -> str:
    """`background-{safeKind}-{uidHash}-{YYYYMMDDTHHMMSSZ}-{shortHash}` (ADR §4),
    then run through ``sanitize_task_id`` so only ``[A-Za-z0-9_-]`` survives."""
    raw = (
        f"background-{kind}-{uid_hash(uid)}-{_compact_ts(scheduled_for_iso)}"
        f"-{_short_hash(schedule_id, kind, scheduled_for_iso)}"
    )
    return sanitize_task_id(raw)
