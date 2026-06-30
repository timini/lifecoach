"""Firestore-backed store for `backgroundProposedActions` (ADR 0001 §6).

A proposed action is a write the run *suggests* (archive a message, create a
task / calendar event) but never performs — it stays `proposed` until a
foreground flow confirms it (step 8) and routes it to the existing Workspace
write tools. Background mode never mutates third-party state (ADR §Decision).

Writes are create-if-absent (replay-safe). The record carries source message
IDs + a short summary only; never email bodies or OAuth tokens.
"""

from __future__ import annotations

from collections.abc import Callable

from lifecoach_agent.contracts.background import BackgroundProposedAction
from lifecoach_agent.storage.background_firestore import BackgroundFirestore, BgTransaction
from lifecoach_agent.storage.background_time import canonical_iso
from lifecoach_agent.storage.background_time import now_iso as _now_iso_default

_COLLECTION = "backgroundProposedActions"


def _doc_path(action_id: str) -> str:
    return f"{_COLLECTION}/{action_id}"


class BackgroundProposedActionStore:
    def __init__(
        self,
        *,
        firestore: BackgroundFirestore,
        now_iso: Callable[[], str] | None = None,
    ) -> None:
        self._fs = firestore
        self._now_iso = now_iso or _now_iso_default

    async def create(self, action: BackgroundProposedAction) -> bool:
        """Create the proposed-action record. Refuses to overwrite an existing
        one (replay-safe). Returns True if created."""
        path = _doc_path(action.id)
        doc = action.model_dump(exclude_none=True)
        # Fixed-width ms+Z for correct string ordering (Codex #202), consistent
        # with the other background stores.
        doc["createdAt"] = canonical_iso(str(doc["createdAt"]))

        async def _txn(txn: BgTransaction) -> bool:
            existing = await txn.get(path)
            if existing.exists:
                return False
            txn.set(path, doc)
            return True

        return await self._fs.run_transaction(_txn)

    async def get(self, action_id: str) -> BackgroundProposedAction | None:
        snap = await self._fs.get(_doc_path(action_id))
        if not snap.exists:
            return None
        data = snap.data()
        if not data:
            return None
        return BackgroundProposedAction.model_validate(data)


def create_background_proposed_action_store(
    *,
    firestore: BackgroundFirestore,
    now_iso: Callable[[], str] | None = None,
) -> BackgroundProposedActionStore:
    return BackgroundProposedActionStore(firestore=firestore, now_iso=now_iso)
