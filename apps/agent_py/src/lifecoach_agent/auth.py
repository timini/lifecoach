"""Firebase ID-token verification + claim mapping.

Mirrors `apps/agent/src/auth.ts`. The verifier is injectable so unit
tests don't depend on `firebase_admin` runtime state — production wires
the real `firebase_admin.auth.verify_id_token` via the
`firebase_admin_verifier()` factory below, which lazily initialises the
default app on first use (Application Default Credentials on Cloud Run).
"""

from __future__ import annotations

import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, Literal


@dataclass(frozen=True)
class FirebaseClaim:
    """Minimal subset of firebase-admin's DecodedIdToken we use."""

    sign_in_provider: str | None = None
    identities: dict[str, list[str]] = field(default_factory=dict)


@dataclass(frozen=True)
class VerifiedClaims:
    uid: str
    email: str | None = None
    email_verified: bool | None = None
    firebase: FirebaseClaim | None = None


# Token verifier hooks. Async to keep the call-site uniform with the
# real `firebase_admin.auth.verify_id_token` (which is sync but cheap)
# wrapped through `asyncio.to_thread`.
TokenVerifier = Callable[[str], Awaitable[VerifiedClaims]]


@dataclass(frozen=True)
class FirebaseUserLike:
    """Structural shape consumed by UserStateMachine. Mirrors
    `packages/user-state/src/types.ts`."""

    isAnonymous: bool  # noqa: N815 — wire field name preserved
    emailVerified: bool  # noqa: N815
    providerData: list[dict[str, Literal["password", "google.com"]]]  # noqa: N815
    workspaceScopesGranted: bool  # noqa: N815


_BEARER_RE = re.compile(r"^Bearer\s+(.+)$", re.IGNORECASE)


def bearer_token_from(header: str | None) -> str | None:
    if not header:
        return None
    m = _BEARER_RE.match(header)
    if m is None:
        return None
    return m.group(1).strip() or None


async def verify_request(
    headers: dict[str, str],
    verifier: TokenVerifier,
) -> VerifiedClaims | None:
    """Pull the Bearer token from `Authorization` and verify it.

    Returns the decoded claims, or None if absent / verification fails.
    Header lookup is case-insensitive on the dict key (`authorization`
    or `Authorization`), mirroring the TS surface that takes a plain
    object — FastAPI's request.headers is case-insensitive in production.
    """
    auth_header = headers.get("authorization") or headers.get("Authorization")
    token = bearer_token_from(auth_header)
    if not token:
        return None
    try:
        return await verifier(token)
    except Exception:  # noqa: BLE001 — any verifier failure → unauthenticated
        return None


def claims_to_firebase_user_like(
    claims: VerifiedClaims, workspace_scopes_granted: bool
) -> FirebaseUserLike:
    """Map Firebase token claims into the structural shape the
    UserStateMachine consumes."""
    fb = claims.firebase
    provider = (fb.sign_in_provider if fb else None) or ""
    identities = (fb.identities if fb else {}) or {}

    has_password = provider == "password" or bool(identities.get("email"))
    has_google = provider == "google.com" or bool(identities.get("google.com"))

    provider_data: list[dict[str, Literal["password", "google.com"]]] = []
    if has_password:
        provider_data.append({"providerId": "password"})
    if has_google:
        provider_data.append({"providerId": "google.com"})

    return FirebaseUserLike(
        isAnonymous=provider == "anonymous",
        emailVerified=claims.email_verified is True,
        providerData=provider_data,
        workspaceScopesGranted=workspace_scopes_granted,
    )


# --- production verifier factory -----------------------------------------


def _claims_from_decoded(decoded: dict[str, Any]) -> VerifiedClaims:
    """Convert the dict returned by `firebase_admin.auth.verify_id_token`
    into our typed `VerifiedClaims`. Tolerates missing optional fields."""
    fb_raw = decoded.get("firebase")
    fb: FirebaseClaim | None = None
    if isinstance(fb_raw, dict):
        sign_in_provider = fb_raw.get("sign_in_provider")
        identities_raw = fb_raw.get("identities")
        identities: dict[str, list[str]] = {}
        if isinstance(identities_raw, dict):
            for k, v in identities_raw.items():
                if isinstance(v, list):
                    identities[k] = [str(x) for x in v]
        fb = FirebaseClaim(
            sign_in_provider=sign_in_provider if isinstance(sign_in_provider, str) else None,
            identities=identities,
        )
    uid = decoded.get("uid") or decoded.get("user_id")
    if not isinstance(uid, str) or not uid:
        raise ValueError("decoded token missing uid")
    email = decoded.get("email")
    email_verified = decoded.get("email_verified")
    return VerifiedClaims(
        uid=uid,
        email=email if isinstance(email, str) else None,
        email_verified=bool(email_verified) if isinstance(email_verified, bool) else None,
        firebase=fb,
    )


def firebase_admin_verifier() -> TokenVerifier:
    """Production verifier — lazily initialises the firebase-admin default
    app on first use, then defers each call to
    `firebase_admin.auth.verify_id_token` on a worker thread."""
    import asyncio

    import firebase_admin  # type: ignore[import-untyped]
    from firebase_admin import auth as fb_auth  # type: ignore[import-untyped]

    _initialised = False

    async def verify(token: str) -> VerifiedClaims:
        nonlocal _initialised
        if not _initialised:
            try:
                firebase_admin.get_app()
            except ValueError:
                firebase_admin.initialize_app()
            _initialised = True
        decoded = await asyncio.to_thread(fb_auth.verify_id_token, token)
        return _claims_from_decoded(decoded)

    return verify
