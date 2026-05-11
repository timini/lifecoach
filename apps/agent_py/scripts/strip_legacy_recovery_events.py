"""One-shot cleanup script: strip legacy empty-turn-recovery events from
stored Firestore session docs.

These events were written by the now-deleted TS-side `emptyTurnGuard`
and are causing live silent-turn failures by poisoning Gemini's context
on subsequent loads. They're identifiable by:

  - `id` starting with `recovery-` (e.g. `recovery-gap-end-ac1b63`)
  - OR `invocationId == "gap-end"`

Both markers are unique to the legacy guard; nothing the new Python
agent emits matches either pattern.

Usage:
    uv run python scripts/strip_legacy_recovery_events.py \\
        --project lifecoach-dev-zvb6d \\
        --app-name lifecoach \\
        --user-id <UID>            # optional — defaults to scanning all users
        --dry-run                  # show what would change without writing

Without --dry-run, the script REWRITES each session doc with the
filtered events array. There is no rollback inside this script — if you
need a rollback, the Firestore daily backup in the dev project is the
recovery surface.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from typing import Any


def _is_legacy_recovery_event(ev: dict[str, Any]) -> bool:
    """Return True if `ev` is a stale event the TS emptyTurnGuard wrote
    that should never reach the model again."""
    if not isinstance(ev, dict):
        return False
    if isinstance(ev.get("invocationId"), str) and ev["invocationId"] == "gap-end":
        return True
    eid = ev.get("id")
    if isinstance(eid, str) and eid.startswith("recovery-"):
        return True
    return False


async def _process_one_session(
    client: Any,
    app_name: str,
    user_id: str,
    session_id: str,
    *,
    dry_run: bool,
    cached_data: dict[str, Any] | None = None,
) -> tuple[int, int]:
    """Return (stripped_count, total_events) for one session doc."""
    path = f"apps/{app_name}/users/{user_id}/sessions/{session_id}"
    if cached_data is None:
        snap = await client.document(path).get()
        if not snap.exists:
            return (0, 0)
        cached_data = snap.to_dict() or {}
    events = cached_data.get("events")
    if not isinstance(events, list):
        return (0, 0)
    total = len(events)
    kept = [ev for ev in events if not _is_legacy_recovery_event(ev)]
    stripped = total - len(kept)
    if stripped == 0:
        return (0, total)

    print(f"  {path}: {stripped}/{total} legacy events to strip")
    if not dry_run:
        await client.document(path).update({"events": kept})
    return (stripped, total)


async def _walk_user(
    client: Any, app_name: str, user_id: str, *, dry_run: bool
) -> tuple[int, int, int]:
    """Return (sessions_with_strips, total_stripped, total_events)."""
    sessions_ref = client.collection(f"apps/{app_name}/users/{user_id}/sessions")
    sess_with_strips = 0
    total_stripped = 0
    total_events = 0
    async for sess_snap in sessions_ref.stream():
        sid = sess_snap.id
        data = sess_snap.to_dict() or {}
        stripped, total = await _process_one_session(
            client, app_name, user_id, sid, dry_run=dry_run, cached_data=data
        )
        if stripped:
            sess_with_strips += 1
        total_stripped += stripped
        total_events += total
    return (sess_with_strips, total_stripped, total_events)


async def _walk_all_users(client: Any, app_name: str, *, dry_run: bool) -> None:
    users_col = client.collection(f"apps/{app_name}/users")
    total_users = 0
    total_sess_with_strips = 0
    total_stripped = 0
    total_events_seen = 0
    async for user_snap in users_col.stream():
        uid = user_snap.id
        total_users += 1
        sess_with_strips, stripped, events_seen = await _walk_user(
            client, app_name, uid, dry_run=dry_run
        )
        if stripped:
            print(f"user {uid}: {stripped} legacy events across {sess_with_strips} session(s)")
        total_sess_with_strips += sess_with_strips
        total_stripped += stripped
        total_events_seen += events_seen
    print(
        "\nSUMMARY: "
        f"users scanned={total_users}, "
        f"sessions with strips={total_sess_with_strips}, "
        f"events stripped={total_stripped}, "
        f"events seen={total_events_seen}, "
        f"dry_run={dry_run}"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True, help="GCP project id (Firestore lives here).")
    parser.add_argument("--app-name", default="lifecoach", help="App name root path. Default lifecoach.")
    parser.add_argument(
        "--user-id",
        default=None,
        help="Process only this user. Omit to scan every user under apps/{app}/users/.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would change without writing.",
    )
    args = parser.parse_args()

    from google.cloud import firestore  # type: ignore[import-untyped]

    client = firestore.AsyncClient(project=args.project)
    if args.user_id:
        sess_with_strips, stripped, events_seen = asyncio.run(
            _walk_user(client, args.app_name, args.user_id, dry_run=args.dry_run)
        )
        print(
            f"\nSUMMARY user={args.user_id}: "
            f"sessions with strips={sess_with_strips}, "
            f"events stripped={stripped}, "
            f"events seen={events_seen}, "
            f"dry_run={args.dry_run}"
        )
    else:
        asyncio.run(_walk_all_users(client, args.app_name, dry_run=args.dry_run))
    return 0


if __name__ == "__main__":
    sys.exit(main())
