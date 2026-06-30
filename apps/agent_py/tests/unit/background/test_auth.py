"""Unit tests for the background OIDC verifier + bearer extraction
(ADR 0001 step 3). The low-level Google verify is injected so the policy
is exercised without hitting Google's JWKS."""

from __future__ import annotations

from typing import Any

import pytest

from lifecoach_agent.background.auth import (
    BackgroundOidcClaims,
    create_oidc_verifier,
    extract_bearer_token,
)

AUD = "https://agent-abc.run.app"


def _google_claims(**over: Any) -> dict[str, Any]:
    base = {
        "iss": "https://accounts.google.com",
        "aud": AUD,
        "email": "sa-background-scheduler@proj.iam.gserviceaccount.com",
        "sub": "12345",
    }
    base.update(over)
    return base


def _verify_returning(claims: dict[str, Any]):  # type: ignore[no-untyped-def]
    def _fn(token: str, audience: str) -> dict[str, Any]:
        return claims

    return _fn


# --- extract_bearer_token -------------------------------------------------


@pytest.mark.parametrize(
    "header,expected",
    [
        (None, None),
        ("", None),
        ("Bearer abc", "abc"),
        ("bearer abc", "abc"),
        ("BEARER  spaced ", "spaced"),
        ("Basic abc", None),
        ("abc", None),
        ("Bearer ", None),
    ],
)
def test_extract_bearer_token(header: str | None, expected: str | None) -> None:
    assert extract_bearer_token(header) == expected


# --- create_oidc_verifier -------------------------------------------------


@pytest.mark.asyncio
async def test_accepts_valid_google_token() -> None:
    verify = create_oidc_verifier(
        expected_audience=AUD, verify_token=_verify_returning(_google_claims())
    )
    claims = await verify("tok")
    assert isinstance(claims, BackgroundOidcClaims)
    assert claims.audience == AUD
    assert claims.email == "sa-background-scheduler@proj.iam.gserviceaccount.com"
    assert claims.subject == "12345"


@pytest.mark.asyncio
async def test_rejects_when_raw_verify_raises() -> None:
    def _boom(token: str, audience: str) -> dict[str, Any]:
        raise ValueError("expired")

    verify = create_oidc_verifier(expected_audience=AUD, verify_token=_boom)
    assert await verify("tok") is None


@pytest.mark.asyncio
async def test_rejects_non_google_issuer() -> None:
    verify = create_oidc_verifier(
        expected_audience=AUD,
        verify_token=_verify_returning(_google_claims(iss="https://evil.example")),
    )
    assert await verify("tok") is None


@pytest.mark.asyncio
async def test_rejects_wrong_audience() -> None:
    verify = create_oidc_verifier(
        expected_audience=AUD,
        verify_token=_verify_returning(_google_claims(aud="https://other.run.app")),
    )
    assert await verify("tok") is None


@pytest.mark.asyncio
async def test_rejects_email_not_in_allowlist() -> None:
    verify = create_oidc_verifier(
        expected_audience=AUD,
        allowed_emails=("only-this@proj.iam.gserviceaccount.com",),
        verify_token=_verify_returning(_google_claims()),
    )
    assert await verify("tok") is None


@pytest.mark.asyncio
async def test_accepts_email_in_allowlist() -> None:
    email = "sa-background-scheduler@proj.iam.gserviceaccount.com"
    verify = create_oidc_verifier(
        expected_audience=AUD,
        allowed_emails=(email,),
        verify_token=_verify_returning(_google_claims()),
    )
    claims = await verify("tok")
    assert claims is not None and claims.email == email


def test_default_google_verify_bridges_to_google_libs(monkeypatch: pytest.MonkeyPatch) -> None:
    """`_default_google_verify` defers to google.oauth2.id_token; patch the
    two google modules so the production verify path runs without network."""
    import sys

    captured: dict[str, Any] = {}

    class _IdTokenShim:
        @staticmethod
        def verify_oauth2_token(token: str, request: Any, audience: str) -> dict[str, Any]:
            captured["token"] = token
            captured["audience"] = audience
            return {"iss": "https://accounts.google.com", "aud": audience}

    class _RequestsShim:
        class Request:  # noqa: N801 — mirrors google.auth.transport.requests.Request
            pass

    monkeypatch.setitem(sys.modules, "google.oauth2.id_token", _IdTokenShim)
    monkeypatch.setitem(sys.modules, "google.auth.transport.requests", _RequestsShim)

    from lifecoach_agent.background.auth import _default_google_verify

    out = _default_google_verify("tok-123", AUD)
    assert out["aud"] == AUD
    assert captured == {"token": "tok-123", "audience": AUD}


@pytest.mark.asyncio
async def test_missing_or_nonstr_email_and_subject_become_none() -> None:
    verify = create_oidc_verifier(
        expected_audience=AUD,
        verify_token=_verify_returning(_google_claims(email=None, sub=123)),
    )
    claims = await verify("tok")
    assert claims is not None
    assert claims.email is None
    assert claims.subject is None
