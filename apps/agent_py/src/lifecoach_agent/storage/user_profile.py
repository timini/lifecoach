"""GCS-bucket-backed user-profile store.

Mirrors `apps/agent/src/storage/userProfile.ts`. Profile lives at
`users/{uid}/user.yaml`. Schema-free (`UserProfile = dict[str, Any]`);
the `update_path()` write-method accepts arbitrary dotted paths and
creates intermediate objects on the fly.
"""

from __future__ import annotations

import copy
from typing import Any, Protocol

import yaml

from lifecoach_agent.contracts import UserProfile, empty_user_profile


class BucketFile(Protocol):
    async def download(self) -> bytes: ...
    async def save(self, contents: str | bytes, content_type: str = ...) -> None: ...
    async def exists(self) -> bool: ...


class BucketLike(Protocol):
    """Minimal bucket surface this store depends on. The
    `google-cloud-storage` `Bucket` satisfies it via a thin adapter
    in `server.py` (Phase 9). Tests inject an in-memory fake."""

    def file(self, path: str) -> BucketFile: ...


class NotFoundError(Exception):
    """Raised by `BucketFile.download()` when the object is missing."""


def user_yaml_path(uid: str) -> str:
    return f"users/{uid}/user.yaml"


def set_dotted_path(obj: dict[str, Any], path: str, value: Any) -> dict[str, Any]:
    """Immutable dotted-path write. Creates intermediate objects."""
    clone = copy.deepcopy(obj)
    parts = path.split(".")
    cursor: dict[str, Any] = clone
    for key in parts[:-1]:
        existing = cursor.get(key)
        if not isinstance(existing, dict):
            cursor[key] = {}
        cursor = cursor[key]
    cursor[parts[-1]] = value
    return clone


def get_dotted_path(obj: dict[str, Any], path: str) -> Any:
    """Read at a dotted path; returns `None` if any segment is missing."""
    cursor: Any = obj
    for key in path.split("."):
        if not isinstance(cursor, dict):
            return None
        cursor = cursor.get(key)
    return cursor


class UserProfileStore:
    def __init__(self, *, bucket: BucketLike) -> None:
        self._bucket = bucket

    async def read(self, uid: str) -> UserProfile:
        f = self._bucket.file(user_yaml_path(uid))
        try:
            buf = await f.download()
        except NotFoundError:
            return empty_user_profile()
        except Exception as err:  # noqa: BLE001
            if _looks_like_not_found(err):
                return empty_user_profile()
            raise
        try:
            text = buf.decode("utf-8") if isinstance(buf, bytes) else str(buf)
            parsed = yaml.safe_load(text)
        except Exception:  # noqa: BLE001 — corrupt YAML → start fresh
            return empty_user_profile()
        if not isinstance(parsed, dict):
            return empty_user_profile()
        return parsed

    async def write(self, uid: str, profile: UserProfile) -> None:
        text = yaml.safe_dump(profile, sort_keys=False, width=120, default_flow_style=False)
        await self._bucket.file(user_yaml_path(uid)).save(text, content_type="application/yaml")

    async def update_path(self, uid: str, path: str, value: Any) -> UserProfile:
        if not path or not isinstance(path, str):
            raise ValueError("path is required")
        current = await self.read(uid)
        updated = set_dotted_path(current, path, value)
        await self.write(uid, updated)
        return updated

    async def read_path(self, uid: str, path: str) -> Any:
        if not path or not isinstance(path, str):
            return None
        profile = await self.read(uid)
        return get_dotted_path(profile, path)


def _looks_like_not_found(err: object) -> bool:
    code = getattr(err, "code", None)
    if code in (404, "404"):
        return True
    msg = str(err)
    return "not found" in msg.lower()


def create_user_profile_store(*, bucket: BucketLike) -> UserProfileStore:
    return UserProfileStore(bucket=bucket)
