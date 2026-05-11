"""In-memory fakes for the storage Protocols. Shared by every storage
test so we don't reinvent them per file."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from lifecoach_agent.storage.user_profile import NotFoundError


@dataclass
class FakeBucketFile:
    bucket: FakeBucket
    path: str

    async def download(self) -> bytes:
        if self.path not in self.bucket.objects:
            raise NotFoundError(f"object not found: {self.path}")
        content = self.bucket.objects[self.path]
        return content.encode("utf-8") if isinstance(content, str) else content

    async def save(
        self, contents: str | bytes, content_type: str = "application/octet-stream"
    ) -> None:
        self.bucket.objects[self.path] = (
            contents.decode("utf-8") if isinstance(contents, bytes) else contents
        )

    async def exists(self) -> bool:
        return self.path in self.bucket.objects


@dataclass
class FakeBucket:
    objects: dict[str, str | bytes] = field(default_factory=dict)

    def file(self, path: str) -> FakeBucketFile:
        return FakeBucketFile(bucket=self, path=path)


# --- Firestore ---


@dataclass
class FakeSnapshot:
    _exists: bool
    _data: dict[str, Any] | None

    @property
    def exists(self) -> bool:
        return self._exists

    def data(self) -> dict[str, Any] | None:
        return self._data


@dataclass
class FakeDocRef:
    fs: FakeFirestore
    path: str

    async def get(self) -> FakeSnapshot:
        if self.path in self.fs.docs:
            return FakeSnapshot(_exists=True, _data=dict(self.fs.docs[self.path]))
        return FakeSnapshot(_exists=False, _data=None)

    async def set(self, value: dict[str, Any], *, merge: bool = False) -> None:
        if merge and self.path in self.fs.docs:
            existing = self.fs.docs[self.path]
            merged = _deep_merge(existing, value)
            self.fs.docs[self.path] = merged
        else:
            self.fs.docs[self.path] = dict(value)

    async def delete(self) -> None:
        self.fs.docs.pop(self.path, None)


@dataclass
class FakeCollectionSnapshot:
    docs_list: list[FakeSnapshot]

    @property
    def docs(self) -> list[FakeSnapshot]:
        return self.docs_list


@dataclass
class FakeCollectionRef:
    fs: FakeFirestore
    prefix: str

    async def get(self) -> FakeCollectionSnapshot:
        snaps: list[FakeSnapshot] = []
        for path, data in self.fs.docs.items():
            if path.startswith(self.prefix + "/") and "/" not in path[len(self.prefix) + 1 :]:
                snaps.append(FakeSnapshot(_exists=True, _data=dict(data)))
        return FakeCollectionSnapshot(docs_list=snaps)


@dataclass
class FakeFirestore:
    docs: dict[str, dict[str, Any]] = field(default_factory=dict)

    def doc(self, path: str) -> FakeDocRef:
        return FakeDocRef(fs=self, path=path)

    def collection(self, path: str) -> FakeCollectionRef:
        return FakeCollectionRef(fs=self, prefix=path)


def _deep_merge(a: dict[str, Any], b: dict[str, Any]) -> dict[str, Any]:
    out = dict(a)
    for k, v in b.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out
