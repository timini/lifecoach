"""OIDC authentication for the service-to-service background endpoints
(ADR 0001, step 3).

Cloud Scheduler and Cloud Tasks call `/background/*` with a Google-signed
OIDC token whose `aud` claim equals the Cloud Run service URL — NOT the
`x-agent-internal-bearer` shared secret the web proxy uses. So the
background routes bypass that middleware and verify the OIDC token here:
signature against Google's keys, `iss` ∈ Google issuers, `aud` == the
exact expected audience (enforced server-side, never trusting `iss`
alone), and optionally the caller's service-account email against an
allowlist.

The verifier is injectable so tests exercise the policy without hitting
Google's JWKS; `main.py` wires the real Google verifier (with the audience
from the OIDC env that infra sets in ADR step 4d).
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

# A Google-issued OIDC token's `iss` is one of these.
_GOOGLE_ISSUERS = frozenset({"https://accounts.google.com", "accounts.google.com"})


@dataclass(frozen=True)
class BackgroundOidcClaims:
    issuer: str
    audience: str
    email: str | None
    subject: str | None


# Given a raw bearer token, return claims if it is a valid Google OIDC token
# for the expected audience (and allowed caller), else None.
BackgroundOidcVerifier = Callable[[str], Awaitable["BackgroundOidcClaims | None"]]

# Low-level token verification: (token, audience) -> claims dict; raises on an
# invalid/expired/wrong-audience token. Defaults to google.oauth2.id_token.
RawTokenVerify = Callable[[str, str], dict[str, Any]]


def extract_bearer_token(authorization: str | None) -> str | None:
    """Pull the token out of an `Authorization: Bearer <token>` header.
    Returns None for a missing/malformed header."""
    if not authorization:
        return None
    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    token = parts[1].strip()
    return token or None


def _default_google_verify(token: str, audience: str) -> dict[str, Any]:
    """Verify a Google OIDC token against Google's public keys, checking the
    signature, expiry, and `aud`. Deferred import so the module loads without
    google-auth in environments that never serve background traffic."""
    from google.auth.transport import requests as ga_requests
    from google.oauth2 import id_token

    request = ga_requests.Request()
    result: dict[str, Any] = id_token.verify_oauth2_token(  # type: ignore[no-untyped-call]
        token, request, audience
    )
    return result


def create_oidc_verifier(
    *,
    expected_audience: str,
    allowed_emails: tuple[str, ...] | None = None,
    verify_token: RawTokenVerify | None = None,
) -> BackgroundOidcVerifier:
    """Build a verifier that accepts only Google OIDC tokens whose `aud`
    matches `expected_audience` (and, if `allowed_emails` is given, whose
    caller email is in that set). Any verification failure → None, so the
    route fails closed."""
    raw_verify = verify_token or _default_google_verify

    async def _verify(token: str) -> BackgroundOidcClaims | None:
        try:
            claims = await asyncio.to_thread(raw_verify, token, expected_audience)
        except Exception:  # noqa: BLE001 — any verification error is a rejection
            return None
        issuer = str(claims.get("iss", ""))
        if issuer not in _GOOGLE_ISSUERS:
            return None
        audience = str(claims.get("aud", ""))
        if audience != expected_audience:
            return None
        email = claims.get("email")
        if allowed_emails is not None and email not in allowed_emails:
            return None
        return BackgroundOidcClaims(
            issuer=issuer,
            audience=audience,
            email=email if isinstance(email, str) else None,
            subject=claims.get("sub") if isinstance(claims.get("sub"), str) else None,
        )

    return _verify
