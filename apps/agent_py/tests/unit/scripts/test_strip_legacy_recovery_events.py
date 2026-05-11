"""Tests for the recovery-event identifier in the cleanup script.

The script writes to live Firestore — those code paths are exercised by
manual dry-runs against the dev project. This unit suite locks in the
predicate so a future refactor can't quietly broaden or narrow what
counts as a 'legacy recovery event'.
"""

from __future__ import annotations

import sys
from pathlib import Path

# The script lives outside the import package (no __init__.py in scripts/).
SCRIPTS_DIR = Path(__file__).resolve().parents[3] / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

from strip_legacy_recovery_events import _is_legacy_recovery_event  # noqa: E402


def test_id_starts_with_recovery_dash_is_legacy() -> None:
    assert _is_legacy_recovery_event({"id": "recovery-gap-end-ac1b63", "author": "lifecoach"})
    assert _is_legacy_recovery_event({"id": "recovery-empty-cab123"})


def test_invocation_id_gap_end_is_legacy() -> None:
    assert _is_legacy_recovery_event(
        {"id": "any-uuid", "invocationId": "gap-end", "author": "lifecoach"}
    )


def test_normal_user_event_is_kept() -> None:
    assert not _is_legacy_recovery_event(
        {"id": "real-uuid-123", "author": "user", "content": {"role": "user"}}
    )


def test_normal_model_event_is_kept() -> None:
    assert not _is_legacy_recovery_event(
        {
            "id": "real-uuid-456",
            "invocationId": "e-917e4f7a-9e86-4850-bb38-c12a05d47c83",
            "author": "lifecoach",
            "content": {"role": "model", "parts": [{"text": "Hello"}]},
        }
    )


def test_non_dict_is_kept() -> None:
    assert not _is_legacy_recovery_event(None)  # type: ignore[arg-type]
    assert not _is_legacy_recovery_event("string")  # type: ignore[arg-type]


def test_id_resembling_recovery_but_not_prefix_is_kept() -> None:
    # Defensive: only the LEADING `recovery-` is the legacy marker.
    # Anything containing recovery- mid-string is unrelated.
    assert not _is_legacy_recovery_event({"id": "user-recovery-discussion"})
