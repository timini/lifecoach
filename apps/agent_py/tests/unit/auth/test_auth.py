"""Smoke tests for the Firebase ID-token verifier surface — the
production wiring is exercised in Phase 9's server tests."""

from __future__ import annotations

import pytest

from lifecoach_agent.auth import (
    FirebaseClaim,
    VerifiedClaims,
    bearer_token_from,
    claims_to_firebase_user_like,
    verify_request,
)


def test_bearer_token_extraction() -> None:
    assert bearer_token_from("Bearer abc.def.ghi") == "abc.def.ghi"
    assert bearer_token_from("bearer xyz") == "xyz"
    assert bearer_token_from(None) is None
    assert bearer_token_from("") is None
    assert bearer_token_from("Token x") is None


@pytest.mark.asyncio
async def test_verify_request_returns_none_when_no_header() -> None:
    async def verifier(_t: str) -> VerifiedClaims:
        raise AssertionError("verifier should not be called")

    assert await verify_request({}, verifier) is None


@pytest.mark.asyncio
async def test_verify_request_returns_none_when_verifier_throws() -> None:
    async def verifier(_t: str) -> VerifiedClaims:
        raise RuntimeError("invalid token")

    out = await verify_request({"authorization": "Bearer x"}, verifier)
    assert out is None


@pytest.mark.asyncio
async def test_verify_request_passes_through_claims() -> None:
    async def verifier(token: str) -> VerifiedClaims:
        return VerifiedClaims(uid="u1", email="t@example.com", email_verified=True)

    out = await verify_request({"Authorization": "Bearer abc"}, verifier)
    assert out is not None
    assert out.uid == "u1"


def test_claims_to_firebase_user_like_anonymous() -> None:
    claims = VerifiedClaims(
        uid="anon",
        firebase=FirebaseClaim(sign_in_provider="anonymous", identities={}),
    )
    out = claims_to_firebase_user_like(claims, workspace_scopes_granted=False)
    assert out.isAnonymous is True
    assert out.providerData == []


def test_claims_to_firebase_user_like_password_verified() -> None:
    claims = VerifiedClaims(
        uid="u1",
        email="x@y.z",
        email_verified=True,
        firebase=FirebaseClaim(sign_in_provider="password", identities={"email": ["x@y.z"]}),
    )
    out = claims_to_firebase_user_like(claims, workspace_scopes_granted=False)
    assert out.isAnonymous is False
    assert out.emailVerified is True
    assert {"providerId": "password"} in out.providerData


def test_claims_to_firebase_user_like_google_with_workspace() -> None:
    claims = VerifiedClaims(
        uid="u1",
        email="x@y.z",
        email_verified=True,
        firebase=FirebaseClaim(sign_in_provider="google.com", identities={"google.com": ["x@y.z"]}),
    )
    out = claims_to_firebase_user_like(claims, workspace_scopes_granted=True)
    assert out.isAnonymous is False
    assert {"providerId": "google.com"} in out.providerData
    assert out.workspaceScopesGranted is True
