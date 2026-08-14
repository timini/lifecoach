"""Smoke tests for UserProfileStore — round-trip + dotted-path
read/write + missing-file handling."""

from __future__ import annotations

import asyncio

import pytest

from lifecoach_agent.storage.user_profile import (
    create_user_profile_store,
    get_dotted_path,
    set_dotted_path,
)
from tests.unit.storage._fakes import FakeBucket


def test_set_dotted_path_creates_intermediate_objects() -> None:
    out = set_dotted_path({}, "family.children[0].name", "Maya")
    assert out == {"family": {"children[0]": {"name": "Maya"}}}


def test_set_dotted_path_overwrites_non_object_intermediates() -> None:
    out = set_dotted_path({"family": "old"}, "family.partner.name", "Alex")
    assert out == {"family": {"partner": {"name": "Alex"}}}


def test_get_dotted_path_returns_value_or_none() -> None:
    obj = {"a": {"b": {"c": 42}}}
    assert get_dotted_path(obj, "a.b.c") == 42
    assert get_dotted_path(obj, "a.b.d") is None
    assert get_dotted_path(obj, "x") is None


@pytest.mark.asyncio
async def test_read_returns_empty_template_when_missing() -> None:
    store = create_user_profile_store(bucket=FakeBucket())
    profile = await store.read("u1")
    assert profile["name"] is None
    assert profile["goals"]["short_term"] == []


@pytest.mark.asyncio
async def test_round_trip_write_then_read() -> None:
    store = create_user_profile_store(bucket=FakeBucket())
    await store.write("u1", {"name": "Tim", "occupation": {"title": "Coach"}})
    profile = await store.read("u1")
    assert profile["name"] == "Tim"
    assert profile["occupation"]["title"] == "Coach"


@pytest.mark.asyncio
async def test_update_path_creates_and_persists() -> None:
    store = create_user_profile_store(bucket=FakeBucket())
    await store.update_path("u1", "preferences.coffee_cutoff", "14:00")
    profile = await store.read("u1")
    assert profile["preferences"]["coffee_cutoff"] == "14:00"


@pytest.mark.asyncio
async def test_read_path_returns_value() -> None:
    store = create_user_profile_store(bucket=FakeBucket())
    await store.write("u1", {"name": "Tim"})
    assert await store.read_path("u1", "name") == "Tim"
    assert await store.read_path("u1", "age") is None


@pytest.mark.asyncio
async def test_context_read_times_out_to_last_known_good_without_affecting_writes() -> None:
    class SlowFile:
        def __init__(self) -> None:
            self.slow = False
            self.contents = b"name: Tim\n"

        async def download(self) -> bytes:
            if self.slow:
                await asyncio.sleep(1)
            return self.contents

        async def save(self, contents: str | bytes, content_type: str = "") -> None:
            self.contents = contents.encode() if isinstance(contents, str) else contents

        async def exists(self) -> bool:
            return True

    class SlowBucket:
        def __init__(self) -> None:
            self.value = SlowFile()

        def file(self, _path: str) -> SlowFile:
            return self.value

    bucket = SlowBucket()
    store = create_user_profile_store(
        bucket=bucket,
        context_timeout_s=0.01,
        context_cache_ttl_s=0,
    )
    assert (await store.read_for_context("u1"))["name"] == "Tim"

    bucket.value.slow = True
    assert (await store.read_for_context("u1"))["name"] == "Tim"

    bucket.value.slow = False
    await store.write("u1", {"name": "Updated"})
    assert (await store.read_for_context("u1"))["name"] == "Updated"
