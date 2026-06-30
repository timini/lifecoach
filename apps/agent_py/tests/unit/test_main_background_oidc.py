"""Unit tests for `_build_background_oidc_verifier` wiring (ADR 0001 step 4d).

Asserts the production wiring reads the infra-set envs and fails closed when
they're absent."""

from __future__ import annotations

import pytest

from lifecoach_agent.main import (
    _build_background_dispatcher,
    _build_background_oidc_verifier,
)

_DISPATCHER_ENVS = (
    "BACKGROUND_OIDC_AUDIENCE",
    "BACKGROUND_INVOKER_SA_EMAIL",
    "BACKGROUND_TASKS_QUEUE",
    "BACKGROUND_TASKS_LOCATION",
    "GOOGLE_CLOUD_PROJECT",
)


_TOKENS = object()  # opaque stand-in for a configured WorkspaceTokensStore


def test_dispatcher_none_when_config_incomplete(monkeypatch: pytest.MonkeyPatch) -> None:
    # Missing any one of the required envs → no dispatcher (tick stays no-op).
    for name in _DISPATCHER_ENVS:
        monkeypatch.delenv(name, raising=False)
    assert _build_background_dispatcher(_TOKENS) is None
    # Even with all-but-one set, still None.
    for name in _DISPATCHER_ENVS[:-1]:
        monkeypatch.setenv(name, "x")
    assert _build_background_dispatcher(_TOKENS) is None


def test_dispatcher_none_without_workspace_tokens(monkeypatch: pytest.MonkeyPatch) -> None:
    # Symmetric with the runner: full background config but no Workspace OAuth →
    # no dispatcher, so the tick never enqueues runs the executor can't run
    # (Codex #203 re-review #5).
    for name in _DISPATCHER_ENVS:
        monkeypatch.setenv(name, "x")
    assert _build_background_dispatcher(None) is None


def test_returns_none_when_audience_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("BACKGROUND_OIDC_AUDIENCE", raising=False)
    monkeypatch.delenv("BACKGROUND_ALLOWED_SA_EMAILS", raising=False)
    assert _build_background_oidc_verifier() is None


def test_builds_verifier_when_audience_set(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("BACKGROUND_OIDC_AUDIENCE", "https://agent.run.app")
    monkeypatch.delenv("BACKGROUND_ALLOWED_SA_EMAILS", raising=False)
    verifier = _build_background_oidc_verifier()
    assert verifier is not None and callable(verifier)


@pytest.mark.asyncio
async def test_verifier_honours_audience_and_allowlist(monkeypatch: pytest.MonkeyPatch) -> None:
    # End-to-end through create_oidc_verifier with an injected raw verify, to
    # prove the parsed audience + allowlist are actually applied.
    monkeypatch.setenv("BACKGROUND_OIDC_AUDIENCE", "https://agent.run.app")
    monkeypatch.setenv(
        "BACKGROUND_ALLOWED_SA_EMAILS",
        "background-scheduler@p.iam.gserviceaccount.com, background-invoker@p.iam.gserviceaccount.com",
    )
    # Patch the low-level google verify BEFORE building — create_oidc_verifier
    # binds the verify fn at construction time.
    import lifecoach_agent.background.auth as auth_mod

    def _fake_verify(token: str, audience: str) -> dict[str, object]:
        return {
            "iss": "https://accounts.google.com",
            "aud": audience,
            "email": token,  # let the test drive the caller email via the token
            "sub": "1",
        }

    monkeypatch.setattr(auth_mod, "_default_google_verify", _fake_verify)

    verifier = _build_background_oidc_verifier()
    assert verifier is not None
    allowed = await verifier("background-scheduler@p.iam.gserviceaccount.com")
    assert allowed is not None and allowed.audience == "https://agent.run.app"

    denied = await verifier("intruder@evil.example")
    assert denied is None
