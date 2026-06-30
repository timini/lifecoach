"""Firestore-backed store for `backgroundNotifications` (ADR 0001 §6).

The executor writes one digest record per successful run; the web digest UI
(step 7b) reads them. Writes are create-if-absent so a duplicate Cloud Task
delivery that slips past the run-lease can't double-write a digest.

Client-safety is enforced by the `BackgroundNotification` contract: items carry
stable Workspace IDs + short snippets only — never full bodies, addresses, or
OAuth tokens (ADR §Security). This store persists whatever the validated
contract allows and nothing more.
"""

from __future__ import annotations

from collections.abc import Callable

from lifecoach_agent.contracts.background import BackgroundNotification
from lifecoach_agent.storage.background_firestore import BackgroundFirestore, BgTransaction
from lifecoach_agent.storage.background_time import canonical_iso
from lifecoach_agent.storage.background_time import now_iso as _now_iso_default

_COLLECTION = "backgroundNotifications"


def _doc_path(notification_id: str) -> str:
    return f"{_COLLECTION}/{notification_id}"


class BackgroundNotificationStore:
    def __init__(
        self,
        *,
        firestore: BackgroundFirestore,
        now_iso: Callable[[], str] | None = None,
    ) -> None:
        self._fs = firestore
        self._now_iso = now_iso or _now_iso_default

    async def create(self, notification: BackgroundNotification) -> bool:
        """Create the digest record. Refuses to overwrite an existing record so
        a replayed run can't double-write. Returns True if created."""
        path = _doc_path(notification.id)
        doc = notification.model_dump(exclude_none=True)
        # Canonicalize to fixed-width ms+Z so the digest UI's
        # `order_by(createdAt)` (and the uid,status,createdAt index) sorts
        # correctly as strings — `…05Z` would otherwise sort after `…05.100Z`
        # (Codex #202).
        doc["createdAt"] = canonical_iso(str(doc["createdAt"]))
        if "expiresAt" in doc:
            doc["expiresAt"] = canonical_iso(str(doc["expiresAt"]))

        async def _txn(txn: BgTransaction) -> bool:
            existing = await txn.get(path)
            if existing.exists:
                return False
            txn.set(path, doc)
            return True

        return await self._fs.run_transaction(_txn)

    async def get(self, notification_id: str) -> BackgroundNotification | None:
        snap = await self._fs.get(_doc_path(notification_id))
        if not snap.exists:
            return None
        data = snap.data()
        if not data:
            return None
        return BackgroundNotification.model_validate(data)


def create_background_notification_store(
    *,
    firestore: BackgroundFirestore,
    now_iso: Callable[[], str] | None = None,
) -> BackgroundNotificationStore:
    return BackgroundNotificationStore(firestore=firestore, now_iso=now_iso)
