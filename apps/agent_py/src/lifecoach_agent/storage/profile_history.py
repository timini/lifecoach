"""Append-only audit log of profile mutations. JSONL at
`users/{uid}/profile-history.jsonl`. Mirrors
`apps/agent/src/storage/profileHistory.ts`."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from lifecoach_agent.storage.user_profile import (
    BucketLike,
    NotFoundError,
    _looks_like_not_found,
)


@dataclass(frozen=True)
class ProfileHistoryEntry:
    """One mutation. `before=None` is the on-disk encoding for
    "path didn't previously exist"."""

    path: str
    before: Any
    after: Any
    at: str  # ISO 8601


def profile_history_path(uid: str) -> str:
    return f"users/{uid}/profile-history.jsonl"


class ProfileHistoryStore:
    def __init__(self, *, bucket: BucketLike) -> None:
        self._bucket = bucket

    async def _read_all(self, uid: str) -> str:
        f = self._bucket.file(profile_history_path(uid))
        try:
            buf = await f.download()
        except NotFoundError:
            return ""
        except Exception as err:  # noqa: BLE001
            if _looks_like_not_found(err):
                return ""
            raise
        return buf.decode("utf-8") if isinstance(buf, bytes) else str(buf)

    async def append(self, uid: str, entry: ProfileHistoryEntry) -> None:
        existing = await self._read_all(uid)
        line = json.dumps(_serialise(entry)) + "\n"
        if not existing or existing.endswith("\n"):
            next_text = existing + line
        else:
            next_text = f"{existing}\n{line}"
        await self._bucket.file(profile_history_path(uid)).save(
            next_text, content_type="application/jsonl"
        )

    async def read(self, uid: str, *, limit: int | None = None) -> list[ProfileHistoryEntry]:
        text = await self._read_all(uid)
        if not text:
            return []
        out: list[ProfileHistoryEntry] = []
        for line in text.split("\n"):
            line = line.strip()
            if not line:
                continue
            try:
                parsed = json.loads(line)
            except Exception:  # noqa: BLE001 — skip malformed line
                continue
            entry = _deserialise(parsed)
            if entry is not None:
                out.append(entry)
        if limit is not None and limit > 0 and len(out) > limit:
            return out[-limit:]
        return out


def _serialise(entry: ProfileHistoryEntry) -> dict[str, Any]:
    return {
        "path": entry.path,
        "before": entry.before if entry.before is not None else None,
        "after": entry.after,
        "at": entry.at,
    }


def _deserialise(raw: Any) -> ProfileHistoryEntry | None:
    if not isinstance(raw, dict):
        return None
    path = raw.get("path")
    at = raw.get("at")
    if not isinstance(path, str) or not isinstance(at, str):
        return None
    return ProfileHistoryEntry(
        path=path,
        before=raw.get("before"),
        after=raw.get("after"),
        at=at,
    )


def create_profile_history_store(*, bucket: BucketLike) -> ProfileHistoryStore:
    return ProfileHistoryStore(bucket=bucket)
