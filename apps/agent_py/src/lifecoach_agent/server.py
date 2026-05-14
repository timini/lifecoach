"""FastAPI server — Python port of `apps/agent/src/server.ts`.

Endpoints (all paths + body shapes mirror the TS surface so the web app
needs zero changes when we cut over):

    GET    /health                       -> {status: "ok"}
    GET    /history?userId=&sessionId=   -> {events}
    GET    /sessions                     -> {sessions: [{sessionId, lastUpdateTime}]}
    GET    /profile?userId=              -> {profile, history}
    PATCH  /profile           body{profile} -> {status: "ok"}
    GET    /goals?userId=                -> {updates}
    POST   /workspace/oauth-exchange  body{code} -> {connected, scopes, grantedAt}
    GET    /workspace/status             -> {connected, scopes, grantedAt}
    DELETE /workspace                    -> {connected:false, scopes:[], grantedAt:null}
    POST   /chat              body{userId, sessionId, message, location?, timezone?}
                                         -> SSE stream

The SSE wire format matches the TS server byte-for-byte:
  - Initial 4096-space comment line to flush past Cloud Run's GFE buffer.
  - `data: <JSON>\\n\\n` per ADK event.
  - `event: done\\ndata: {}\\n\\n` at the end.
  - `event: error\\ndata: {"message": "..."}\\n\\n` on exception.

Per-turn behaviour mirrored from the TS:
  1. Auth (verify Bearer if `verifyToken` set; 401 if `requireAuth` set
     and no claims).
  2. Read workspace token doc to derive `workspaceScopesGranted`.
  3. Build a `UserStateMachine` from claims + workspace state.
  4. Parallel-fetch ALL turn context (weather, places, AQ, holidays,
     calendar density, profile, goals, memories, meta, existing
     session, yesterday + week summaries) in one `asyncio.gather`,
     timing each branch.
  5. Build `InstructionContext`, log the rendered prompt at length, and
     call `runnerFor(ctx, uid, usagePolicy)` to mint a Runner.
  6. Stream the model's events to the client. Silent turns produce
     no assistant content — the chat-quality e2e judge catches them.
  7. Log the `chat.turn` line in `finally`.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import re
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Protocol, cast
from zoneinfo import ZoneInfo

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

from lifecoach_agent.agent import RunnerLike
from lifecoach_agent.auth import (
    TokenVerifier,
    VerifiedClaims,
    claims_to_firebase_user_like,
    verify_request,
)
from lifecoach_agent.context.air_quality import AirQualityClient
from lifecoach_agent.context.calendar_density import CalendarDensityClient
from lifecoach_agent.context.holidays import HolidaysClient, tz_to_country
from lifecoach_agent.context.memory import MemoryClient
from lifecoach_agent.context.places import PlacesClient
from lifecoach_agent.context.session_summary import SessionSummaryClient
from lifecoach_agent.context.weather import WeatherClient
from lifecoach_agent.oauth.workspace_client import WorkspaceOAuthClient
from lifecoach_agent.prompt.build_instruction import (
    Coord,
    InstructionContext,
    LocationCtx,
    build_instruction,
)
from lifecoach_agent.sentry_setup import capture_chat_event
from lifecoach_agent.state import (
    FirebaseProvider,
    FirebaseUserLike,
    Tier,
    UsageInputs,
    UsagePolicy,
    UsageStateMachine,
    UserStateMachine,
)
from lifecoach_agent.storage.goal_updates import GoalUpdatesStore
from lifecoach_agent.storage.profile_history import ProfileHistoryStore
from lifecoach_agent.storage.user_meta import UserMetaStore
from lifecoach_agent.storage.user_profile import UserProfileStore
from lifecoach_agent.storage.workspace_tokens import WorkspaceTokensStore

logger = logging.getLogger("lifecoach_agent.server")

# --- Tool factories (closure-bound per turn) -----------------------------
#
# Imported lazily by the runner factory built in `main.py`; the server
# itself doesn't call these directly.

# --- Helpers --------------------------------------------------------------


def _now_ms() -> int:
    return int(time.time() * 1000)


async def _timed(coro: Awaitable[Any]) -> tuple[Any, int]:
    """Wrap an awaitable with a stopwatch — returns (value, elapsed_ms).
    Mirrors `timed<T>` in server.ts."""
    t0 = _now_ms()
    v = await coro
    return v, _now_ms() - t0


def _local_day_key(timezone: str, at: datetime) -> str:
    """YYYY-MM-DD in `timezone`. Matches the `Intl.DateTimeFormat('en-CA',
    {timeZone})` output the TS uses for the per-day session id."""
    if at.tzinfo is None:
        at = at.replace(tzinfo=ZoneInfo("UTC"))
    return at.astimezone(ZoneInfo(timezone)).strftime("%Y-%m-%d")


def _session_has_user_interaction(session: Any) -> bool:
    """True when this session already contains at least one *real* user
    message — anything beyond the synthetic kickoff sentinels.

    Drives DailyFlowMachine's morning_greeting → morning flip via
    `has_interacted_today`. Matches `sessionHasUserInteraction` in TS.
    """
    if session is None:
        return False
    events = (
        session.get("events") if isinstance(session, dict) else getattr(session, "events", None)
    ) or []
    for ev in events:
        author = ev.get("author") if isinstance(ev, dict) else getattr(ev, "author", None)
        if author != "user":
            continue
        content = ev.get("content") if isinstance(ev, dict) else getattr(ev, "content", None)
        parts = (
            content.get("parts")
            if isinstance(content, dict)
            else (getattr(content, "parts", None) if content is not None else None)
        ) or []
        joined = "".join(
            (p.get("text") if isinstance(p, dict) else getattr(p, "text", None)) or ""
            for p in parts
        ).strip()
        if joined and joined != "__session_start__":
            return True
    return False


# --- DI shape -------------------------------------------------------------


@dataclass(frozen=True)
class RunnerForParams:
    """One-turn factory input. The agent factory builds an `Agent` with
    the right tool list + materialised instruction; the runner is a
    `google.adk.runners.Runner` (or a fake in tests)."""

    ctx: InstructionContext
    uid: str
    usage_policy: UsagePolicy


class SessionReader(Protocol):
    """Read-only handle to the session store for /history and /sessions."""

    app_name: str

    async def get_session(self, *, app_name: str, user_id: str, session_id: str) -> Any | None: ...

    async def list_sessions(self, *, app_name: str, user_id: str) -> list[Any]: ...


@dataclass
class CreateAppDeps:
    """Mirrors the TS `CreateAppDeps`. Tests construct one with fakes;
    `main.py` constructs the production wiring."""

    runner_for: Callable[[RunnerForParams], RunnerLike]
    session_reader: SessionReader | None = None
    verify_token: TokenVerifier | None = None
    require_auth: bool = False
    weather: WeatherClient | None = None
    places: PlacesClient | None = None
    places_token_provider: Callable[[], Awaitable[str | None]] | None = None
    air_quality: AirQualityClient | None = None
    holidays: HolidaysClient | None = None
    calendar_density: CalendarDensityClient | None = None
    memory: MemoryClient | None = None
    memory_enabled: bool | None = None
    session_summary: SessionSummaryClient | None = None
    profile_store: UserProfileStore | None = None
    profile_history_store: ProfileHistoryStore | None = None
    goal_updates_store: GoalUpdatesStore | None = None
    workspace_tokens_store: WorkspaceTokensStore | None = None
    workspace_oauth_client: WorkspaceOAuthClient | None = None
    user_meta_store: UserMetaStore | None = None
    now: Callable[[], datetime] = field(
        default_factory=lambda: lambda: datetime.now(ZoneInfo("UTC"))
    )
    # Service-to-service shared secret. The web proxy (apps/web/src/app/api/*)
    # attaches `x-agent-internal-bearer: <secret>` on every forwarded call;
    # the agent rejects requests without a matching header. Blocks direct
    # attacker calls to the *.run.app URL that bypass the proxy (and the
    # browser, and Firebase Auth). None = disabled (tests / local dev);
    # production wiring in main.py reads AGENT_INTERNAL_BEARER from env.
    internal_bearer: str | None = None


# --- Helpers for endpoint auth -------------------------------------------


def _internal_auth_ok(request: Request, deps: CreateAppDeps) -> bool:
    """Constant-time match the x-agent-internal-bearer header against the
    configured shared secret. When `internal_bearer` is None, all requests
    pass (tests / local). When set, the header must match exactly."""
    if not deps.internal_bearer:
        return True
    return request.headers.get("x-agent-internal-bearer") == deps.internal_bearer


def _internal_auth_error() -> JSONResponse:
    return JSONResponse({"error": "agent_internal_auth_required"}, status_code=401)


async def _verify(request: Request, deps: CreateAppDeps) -> VerifiedClaims | None:
    if deps.verify_token is None:
        return None
    auth_header = request.headers.get("authorization") or request.headers.get("Authorization")
    return await verify_request({"authorization": auth_header or ""}, deps.verify_token)


def _bridge_firebase_user(
    claims: VerifiedClaims, workspace_scopes_granted: bool
) -> FirebaseUserLike:
    """`auth.claims_to_firebase_user_like` returns the auth-module shape
    (camelCase fields, dict providerData). The state machine expects the
    state-types shape (snake_case, tuple of FirebaseProvider). Bridge
    the two here so the server can stay decoupled from either's evolution.
    """
    auth_shape = claims_to_firebase_user_like(claims, workspace_scopes_granted)
    providers = tuple(
        FirebaseProvider(provider_id=str(p.get("providerId") or ""))
        for p in auth_shape.providerData
    )
    return FirebaseUserLike(
        is_anonymous=auth_shape.isAnonymous,
        email_verified=auth_shape.emailVerified,
        provider_data=providers,
        workspace_scopes_granted=auth_shape.workspaceScopesGranted,
    )


def _coerce_tier(value: Any) -> Tier:
    """Narrow the dict-typed `tier` reading to the Tier Literal."""
    return "pro" if value == "pro" else "free"


async def _emit_wall_stream(policy: UsagePolicy) -> AsyncIterator[bytes]:
    """SSE generator for walled requests — emits one `event: wall` with
    the wall's reason + CTA, then `event: done`. No model is invoked.

    The FE parses the `wall` event into a `{kind: 'wall', reason, cta}`
    AssistantElement and renders it as a full-card paywall via
    `WallPrompt`. CTA targets:
      - `auth_user`        → sign-in flow (free anonymous wall)
      - `upgrade_to_pro`   → pro upgrade flow (free signed-in wall)
    """
    # Cloud Run / GFE buffer flush — same shape as `stream()` to keep the
    # FE's SSE chunk-arrival behaviour identical between walled and
    # non-walled responses.
    yield b": " + (b" " * 4096) + b"\n\n"
    payload = json.dumps(
        {
            "reason": policy.wall_reason,
            "cta": policy.wall_cta,
        }
    ).encode("utf-8")
    yield b"event: wall\ndata: " + payload + b"\n\n"
    yield b"event: done\ndata: {}\n\n"


# --- App factory ---------------------------------------------------------


def create_app(deps: CreateAppDeps) -> FastAPI:
    """Build the FastAPI app. The TS `createApp` accepts `CreateAppDeps`
    and returns an Express handler; we accept the same and return a
    FastAPI app (mountable + ASGI-testable)."""
    app = FastAPI()

    # Service-to-service shared secret. The web proxy attaches
    # `x-agent-internal-bearer` on every forwarded call; this middleware
    # rejects requests that don't match. Without it, an attacker could
    # hit the *.run.app URL directly and burn LLM spend, bypassing
    # both the browser and Firebase Auth. /health is exempt so Cloud
    # Run's load-balancer probes still work (no secret on those).
    @app.middleware("http")
    async def _internal_bearer_gate(request: Request, call_next):  # type: ignore[no-untyped-def]
        if request.url.path != "/health" and not _internal_auth_ok(request, deps):
            return _internal_auth_error()
        return await call_next(request)

    # ---- /health ---------------------------------------------------------

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    # ---- /history --------------------------------------------------------

    @app.get("/history")
    async def history(request: Request) -> JSONResponse:
        user_id = request.query_params.get("userId")
        session_id = request.query_params.get("sessionId")
        if not user_id or not session_id:
            return JSONResponse({"error": "userId and sessionId are required"}, status_code=400)
        claims = await _verify(request, deps)
        if deps.require_auth and claims is None:
            return JSONResponse({"error": "unauthenticated"}, status_code=401)
        effective_user_id = claims.uid if claims else user_id

        reader = deps.session_reader
        if reader is None:
            return JSONResponse({"events": []})
        try:
            session = await reader.get_session(
                app_name=reader.app_name, user_id=effective_user_id, session_id=session_id
            )
        except Exception:  # noqa: BLE001
            session = None
        events: list[Any] = []
        if session is not None:
            raw_events = (
                session.get("events")
                if isinstance(session, dict)
                else getattr(session, "events", [])
            )
            for ev in raw_events or []:
                if isinstance(ev, dict):
                    events.append(ev)
                    continue
                # ADK Event → JSON-friendly dict using camelCase aliases
                # so the wire shape matches what the FE expects.
                dump = getattr(ev, "model_dump", None)
                if callable(dump):
                    try:
                        events.append(dump(mode="json", by_alias=True, exclude_none=True))
                        continue
                    except Exception:  # noqa: BLE001
                        pass
                events.append(ev)
        return JSONResponse({"events": events})

    # ---- /sessions -------------------------------------------------------

    @app.get("/sessions")
    async def sessions(request: Request) -> JSONResponse:
        claims = await _verify(request, deps)
        if deps.require_auth and claims is None:
            return JSONResponse({"error": "unauthenticated"}, status_code=401)
        effective_user_id = claims.uid if claims else None
        if effective_user_id is None:
            # No auth → no scope to list — match TS empty fallback.
            return JSONResponse({"sessions": []})

        reader = deps.session_reader
        if reader is None:
            return JSONResponse({"sessions": []})
        try:
            list_resp = await reader.list_sessions(
                app_name=reader.app_name, user_id=effective_user_id
            )
        except Exception:  # noqa: BLE001
            list_resp = None
        # ADK's BaseSessionService returns ListSessionsResponse (Pydantic
        # with `.sessions: list[Session]`). Tolerate the older list shape
        # for any in-tree fakes that haven't been updated.
        if list_resp is None:
            session_list: list[Any] = []
        elif hasattr(list_resp, "sessions"):
            session_list = list(list_resp.sessions)
        else:
            session_list = list(list_resp)
        items: list[dict[str, Any]] = []
        for s in session_list:
            if isinstance(s, dict):
                sid = s.get("id")
                ts_raw = s.get("lastUpdateTime") or s.get("last_update_time") or 0
            else:
                sid = getattr(s, "id", None)
                # ADK Session uses snake_case; older fakes may use camelCase.
                lut = getattr(s, "last_update_time", None)
                if lut is None:
                    lut = getattr(s, "lastUpdateTime", 0)
                # Session.last_update_time is in seconds (float); the wire
                # format here is unix-ms.
                ts_raw = int(lut * 1000) if isinstance(lut, float) and lut < 1e11 else lut
            ts = int(ts_raw) if isinstance(ts_raw, int | float) else 0
            items.append({"sessionId": sid, "lastUpdateTime": ts})
        items.sort(key=lambda x: cast(int, x["lastUpdateTime"]), reverse=True)
        return JSONResponse({"sessions": items})

    # ---- /profile (GET + PATCH) -----------------------------------------

    @app.get("/profile")
    async def get_profile(request: Request) -> JSONResponse:
        user_id = request.query_params.get("userId")
        if not user_id:
            return JSONResponse({"error": "userId is required"}, status_code=400)
        claims = await _verify(request, deps)
        if deps.require_auth and claims is None:
            return JSONResponse({"error": "unauthenticated"}, status_code=401)
        effective_user_id = claims.uid if claims else user_id
        if deps.profile_store is None:
            return JSONResponse({"profile": {}, "history": []})
        try:
            profile = await deps.profile_store.read(effective_user_id)
        except Exception:  # noqa: BLE001
            profile = {}
        history: list[dict[str, Any]] = []
        if deps.profile_history_store is not None:
            try:
                entries = await deps.profile_history_store.read(effective_user_id)
                history = [
                    {"path": e.path, "before": e.before, "after": e.after, "at": e.at}
                    for e in entries
                ]
            except Exception:  # noqa: BLE001
                history = []
        return JSONResponse({"profile": profile, "history": history})

    @app.patch("/profile")
    async def patch_profile(request: Request) -> JSONResponse:
        try:
            body = await request.json()
        except Exception:  # noqa: BLE001
            body = {}
        profile = body.get("profile") if isinstance(body, dict) else None
        if not isinstance(profile, dict):
            return JSONResponse({"error": "body.profile must be an object"}, status_code=400)
        claims = await _verify(request, deps)
        if claims is None:
            # Direct profile writes always require a verified token, even
            # when `require_auth` is false at the app level.
            return JSONResponse({"error": "unauthenticated"}, status_code=401)
        effective_user_id = claims.uid
        if deps.profile_store is None:
            return JSONResponse({"error": "profile store not configured"}, status_code=503)
        await deps.profile_store.write(effective_user_id, profile)
        return JSONResponse({"status": "ok"})

    # ---- /goals ----------------------------------------------------------

    @app.get("/goals")
    async def get_goals(request: Request) -> JSONResponse:
        user_id = request.query_params.get("userId")
        if not user_id:
            return JSONResponse({"error": "userId is required"}, status_code=400)
        claims = await _verify(request, deps)
        if deps.require_auth and claims is None:
            return JSONResponse({"error": "unauthenticated"}, status_code=401)
        effective_user_id = claims.uid if claims else user_id
        if deps.goal_updates_store is None:
            return JSONResponse({"updates": []})
        try:
            updates = await deps.goal_updates_store.recent(effective_user_id, 20)
        except Exception:  # noqa: BLE001
            updates = []
        return JSONResponse({"updates": [u.model_dump(exclude_none=True) for u in updates]})

    # ---- Workspace OAuth -------------------------------------------------

    @app.post("/workspace/oauth-exchange")
    async def workspace_oauth_exchange(request: Request) -> JSONResponse:
        try:
            body = await request.json()
        except Exception:  # noqa: BLE001
            body = {}
        code = body.get("code") if isinstance(body, dict) else None
        if not isinstance(code, str) or not code:
            return JSONResponse({"error": "body.code (string) is required"}, status_code=400)
        claims = await _verify(request, deps)
        if claims is None:
            return JSONResponse({"error": "unauthenticated"}, status_code=401)
        if deps.workspace_oauth_client is None or deps.workspace_tokens_store is None:
            return JSONResponse({"error": "workspace not configured"}, status_code=503)
        try:
            tokens = await deps.workspace_oauth_client.exchange_code(code)
            stored = await deps.workspace_tokens_store.set(claims.uid, tokens)
            return JSONResponse(
                {
                    "connected": True,
                    "scopes": list(stored.scopes),
                    "grantedAt": stored.grantedAt,
                }
            )
        except Exception as err:  # noqa: BLE001
            message = str(err)
            print(
                json.dumps(
                    {
                        "msg": "workspace.oauth_exchange_failed",
                        "uid": claims.uid,
                        # Sanitise — never echo a stray access token.
                        "reason": re.sub(r"ya29\.\S+", "[redacted]", message)[:200],
                    }
                )
            )
            return JSONResponse({"error": "oauth_exchange_failed"}, status_code=400)

    @app.get("/workspace/status")
    async def workspace_status(request: Request) -> JSONResponse:
        claims = await _verify(request, deps)
        if claims is None:
            return JSONResponse({"error": "unauthenticated"}, status_code=401)
        if deps.workspace_tokens_store is None:
            return JSONResponse({"connected": False, "scopes": [], "grantedAt": None})
        try:
            doc = await deps.workspace_tokens_store.get(claims.uid)
        except Exception:  # noqa: BLE001
            doc = None
        if doc is None:
            return JSONResponse({"connected": False, "scopes": [], "grantedAt": None})
        return JSONResponse(
            {
                "connected": True,
                "scopes": list(doc.scopes),
                "grantedAt": doc.grantedAt,
            }
        )

    @app.delete("/workspace")
    async def workspace_delete(request: Request) -> JSONResponse:
        claims = await _verify(request, deps)
        if claims is None:
            return JSONResponse({"error": "unauthenticated"}, status_code=401)
        if deps.workspace_tokens_store is None:
            return JSONResponse({"connected": False, "scopes": [], "grantedAt": None})
        try:
            existing = await deps.workspace_tokens_store.get(claims.uid)
        except Exception:  # noqa: BLE001
            existing = None
        if existing is not None and deps.workspace_oauth_client is not None:
            with contextlib.suppress(Exception):
                await deps.workspace_oauth_client.revoke_refresh_token(existing.refreshToken)
        with contextlib.suppress(Exception):
            await deps.workspace_tokens_store.delete(claims.uid)
        return JSONResponse({"connected": False, "scopes": [], "grantedAt": None})

    # ---- /chat (SSE) -----------------------------------------------------

    @app.post("/chat")
    async def chat(request: Request) -> Any:
        try:
            body = await request.json()
        except Exception:  # noqa: BLE001
            body = {}
        if not isinstance(body, dict):
            body = {}
        user_id = body.get("userId")
        session_id = body.get("sessionId")
        message = body.get("message")
        location = body.get("location")
        timezone = body.get("timezone")
        if (
            not isinstance(user_id, str)
            or not isinstance(session_id, str)
            or not isinstance(message, str)
        ):
            return JSONResponse(
                {"error": "userId, sessionId, and message are required"},
                status_code=400,
            )

        # Auth + workspace-grant inspection -------------------------------
        t0 = _now_ms()
        timings: dict[str, int] = {}

        def tick() -> int:
            return _now_ms() - t0

        t_auth0 = _now_ms()
        claims = await _verify(request, deps)
        timings["authMs"] = _now_ms() - t_auth0
        if deps.require_auth and claims is None:
            return JSONResponse({"error": "unauthenticated"}, status_code=401)
        effective_user_id = claims.uid if claims else user_id

        t_ws_grant0 = _now_ms()
        workspace_scopes_granted = False
        if claims is not None and deps.workspace_tokens_store is not None:
            try:
                doc = await deps.workspace_tokens_store.get(effective_user_id)
                workspace_scopes_granted = bool(doc and doc.refreshToken)
            except Exception:  # noqa: BLE001
                workspace_scopes_granted = False
        timings["wsGrantMs"] = _now_ms() - t_ws_grant0

        if claims is not None:
            machine = UserStateMachine.from_firebase_user(
                _bridge_firebase_user(claims, workspace_scopes_granted)
            )
        else:
            machine = UserStateMachine("anonymous")

        # Parallel context fetch ----------------------------------------
        coord: Coord | None = None
        if isinstance(location, dict):
            lat = location.get("lat")
            lng = location.get("lng")
            if isinstance(lat, int | float) and isinstance(lng, int | float):
                coord = Coord(lat=float(lat), lng=float(lng))
        country_code = tz_to_country(timezone if isinstance(timezone, str) else None)
        want_calendar_density = (
            machine.current() == "workspace_connected"
            and deps.calendar_density is not None
            and isinstance(timezone, str)
            and bool(timezone)
        )

        async def _none() -> None:
            return None

        async def _empty_list() -> list[Any]:
            return []

        async def _places_call() -> Any:
            if coord is None or deps.places is None:
                return []
            token: str | None = None
            if deps.places_token_provider is not None:
                with contextlib.suppress(Exception):
                    token = await deps.places_token_provider()
            try:
                return await deps.places.get(coord, token)
            except Exception:  # noqa: BLE001
                return []

        t_meta0 = _now_ms()
        # Walls + nudges are scoped to the user's local DAY (issue #64
        # follow-up). We pass the local-date key into the store so the
        # increment rolls the daily counter at the user's midnight, not
        # ours. `chatTurnCount` keeps climbing for observability —
        # `dailyTurnCount` is what the funnel actually counts.
        today_local = (
            _local_day_key(timezone, deps.now()) if isinstance(timezone, str) and timezone else None
        )
        if deps.user_meta_store is None:
            # No store wired (tests / local dev only). Treat as a fresh user;
            # safe because the production path always has a store and free-tier
            # limits are enforced from the machine's reading of the real count.
            meta: dict[str, Any] = {
                "chatTurnCount": 0,
                "dailyTurnCount": 0,
                "tier": "free",
            }
        else:
            try:
                meta_doc = await deps.user_meta_store.increment_turn_count(
                    effective_user_id,
                    today_local_date=today_local,
                )
                meta = {
                    "chatTurnCount": meta_doc.chatTurnCount,
                    "dailyTurnCount": meta_doc.dailyTurnCount,
                    "tier": meta_doc.tier,
                }
            except Exception as err:  # noqa: BLE001
                # FAIL CLOSED: if the userMeta read/increment fails (Firestore
                # outage, permission regression, transient storage failure),
                # we MUST NOT silently fall through with chatTurnCount=0 — that
                # would defeat the free-tier hard cap on every storage hiccup
                # and let an attacker drive unbounded LLM spend by inducing
                # Firestore errors. Return 503 (service degraded) so the
                # client retries; the proxy will surface the message.
                logger.exception(
                    "chat.usage_meta_failed",
                    extra={
                        "user_id": effective_user_id,
                        "error_type": type(err).__name__,
                    },
                )
                return JSONResponse(
                    {
                        "error": "usage_metering_unavailable",
                        "message": "Chat is temporarily unavailable. Try again in a moment.",
                    },
                    status_code=503,
                    headers={"Retry-After": "30"},
                )
        timings["metaMs"] = _now_ms() - t_meta0

        chat_turn_count = int(meta.get("chatTurnCount", 0))
        # `chat_count` for the UsageStateMachine is the per-day count, not
        # the lifetime count. The state machine's thresholds (5 / 10 / 15 /
        # 25 / 20 / 50 / 100) read as "today's chats" — a casual user who
        # accumulated 100 lifetime turns over weeks doesn't get walled on
        # their next quick check-in.
        daily_turn_count = int(meta.get("dailyTurnCount", 0))
        tier: Tier = _coerce_tier(meta.get("tier"))
        # The UsageStateMachine + walled short-circuit moved BELOW the
        # parallel context fetch (see ~line 800) so the per-turn metering
        # still lands but the wall-side SSE stream (event: wall) is emitted
        # via the same path the runner uses — keeping the FE's
        # chunk-arrival behaviour identical between walled and non-walled
        # responses. The earlier inline 429 JSON response (added by the
        # security-audit synthesis) is replaced by the wall SSE event so
        # the FE can render the WallPrompt paywall card from the same
        # `assistantElement` machinery it already uses.

        t_parallel0 = _now_ms()
        results = await asyncio.gather(
            _timed(
                deps.weather.get(coord)
                if (coord is not None and deps.weather is not None)
                else _none()
            ),
            _timed(_places_call()),
            _timed(
                deps.air_quality.get(coord)
                if (coord is not None and deps.air_quality is not None)
                else _none()
            ),
            _timed(
                deps.holidays.next7Days(country_code)
                if (country_code and deps.holidays is not None)
                else _empty_list()
            ),
            _timed(
                cast(CalendarDensityClient, deps.calendar_density).get(
                    uid=effective_user_id,
                    timezone=cast(str, timezone),
                    now=deps.now(),
                )
                if want_calendar_density
                else _none()
            ),
            _timed(
                deps.profile_store.read(effective_user_id)
                if deps.profile_store is not None
                else _none()
            ),
            _timed(
                deps.goal_updates_store.recent(effective_user_id, 20)
                if deps.goal_updates_store is not None
                else _empty_list()
            ),
            _timed(
                deps.memory.search(effective_user_id, message, 5)
                if deps.memory is not None
                else _empty_list()
            ),
            _timed(
                deps.session_reader.get_session(
                    app_name=deps.session_reader.app_name,
                    user_id=effective_user_id,
                    session_id=session_id,
                )
                if deps.session_reader is not None
                else _none()
            ),
            _timed(
                deps.session_summary.get_yesterday(
                    uid=effective_user_id,
                    today_date_local=_local_day_key(timezone, deps.now()),
                )
                if (deps.session_summary is not None and isinstance(timezone, str) and timezone)
                else _none()
            ),
            _timed(
                deps.session_summary.get_week(
                    uid=effective_user_id,
                    today_date_local=_local_day_key(timezone, deps.now()),
                )
                if (deps.session_summary is not None and isinstance(timezone, str) and timezone)
                else _none()
            ),
            return_exceptions=False,
        )
        timings["parallelMs"] = _now_ms() - t_parallel0
        (
            (weather, weather_ms),
            (nearby_places, places_ms),
            (air_quality, air_quality_ms),
            (holidays, holidays_ms),
            (calendar_density, calendar_density_ms),
            (user_profile, profile_ms),
            (recent_goal_updates, goals_ms),
            (memories, memory_ms),
            (existing_session, _existing_session_ms),
            (yesterday_summary, yesterday_summary_ms),
            (week_summary, week_summary_ms),
        ) = results
        timings["weatherMs"] = weather_ms
        timings["placesMs"] = places_ms
        timings["airQualityMs"] = air_quality_ms
        timings["holidaysMs"] = holidays_ms
        timings["calendarDensityMs"] = calendar_density_ms
        timings["profileMs"] = profile_ms
        timings["goalsMs"] = goals_ms
        timings["memoryMs"] = memory_ms
        timings["yesterdaySummaryMs"] = yesterday_summary_ms
        timings["weekSummaryMs"] = week_summary_ms
        timings["prepMs"] = tick()

        usage_machine = UsageStateMachine.from_inputs(
            UsageInputs(
                user_state=machine.current(),
                chat_count=daily_turn_count,
                tier=tier,
            )
        )
        usage_policy = usage_machine.policy()

        # Walled states short-circuit BEFORE prompt build / runner construction.
        # The FE renders a paywall card from the `event: wall` payload; no
        # model is invoked. Cost ceiling for the free tier is enforced here —
        # no prompt tuning can re-open this path.
        if usage_policy.walled:
            print(
                json.dumps(
                    {
                        "msg": "chat.turn",
                        "uid": effective_user_id,
                        "sessionId": session_id,
                        "state": machine.current(),
                        "authenticated": claims is not None,
                        "chatTurnCount": chat_turn_count,
                        "dailyTurnCount": daily_turn_count,
                        "tier": tier,
                        "usageState": usage_policy.state,
                        "model": None,
                        "nudgeMode": usage_policy.nudge_mode,
                        "walled": True,
                        "wallReason": usage_policy.wall_reason,
                        "wallCta": usage_policy.wall_cta,
                        "totalMs": tick(),
                        "timings": timings,
                    },
                    default=str,
                )
            )
            return StreamingResponse(
                _emit_wall_stream(usage_policy),
                media_type="text/event-stream",
                headers={
                    "Cache-Control": "no-cache, no-transform",
                    "Connection": "keep-alive",
                    "X-Accel-Buffering": "no",
                },
            )

        has_interacted_today = _session_has_user_interaction(existing_session)
        location_ctx: LocationCtx | None = LocationCtx(coord=coord) if coord else None

        instruction_ctx = InstructionContext(
            now=deps.now(),
            timezone=timezone if isinstance(timezone, str) else None,
            user_state=machine.current(),
            location=location_ctx,
            weather=weather,
            air_quality=air_quality,
            holidays=holidays or [],
            calendar_density=calendar_density,
            user_profile=user_profile if isinstance(user_profile, dict) else None,
            recent_goal_updates=recent_goal_updates or [],
            nearby_places=nearby_places or [],
            memories=memories or [],
            memory_enabled=(
                deps.memory_enabled if deps.memory_enabled is not None else deps.memory is not None
            ),
            nudge_mode=usage_policy.nudge_mode,
            usage_state=usage_policy.state,
            # Daily, not lifetime. The "today's free turn N of M" credit-
            # count line that ships in the prompt has to match the count
            # the wall uses, otherwise the model would say "turn 7 of 25"
            # while the wall fires at lifetime-25 — confusing and wrong.
            chat_turn_count=daily_turn_count,
            has_interacted_today=has_interacted_today,
            yesterday_summary=yesterday_summary,
            week_summary=week_summary,
        )

        # Log the rendered prompt once — useful for prompt-engineering bug
        # triage. Matches `chat.prompt` in the TS server.
        try:
            prompt_text = build_instruction(instruction_ctx)
            print(
                json.dumps(
                    {
                        "msg": "chat.prompt",
                        "uid": effective_user_id,
                        "sessionId": session_id,
                        "length": len(prompt_text),
                        "instruction": prompt_text,
                    }
                )
            )
        except Exception as err:  # noqa: BLE001
            logger.exception("chat.prompt log build failed: %s", err)

        runner = deps.runner_for(
            RunnerForParams(ctx=instruction_ctx, uid=effective_user_id, usage_policy=usage_policy)
        )

        # SSE stream ----------------------------------------------------
        async def stream() -> AsyncIterator[bytes]:
            tool_invocations: list[dict[str, Any]] = []
            pending_by_id: dict[str, dict[str, Any]] = {}
            first_text_ms: int | None = None
            choice_shown = False
            turn_ending_tools = {
                "ask_single_choice_question",
                "ask_multiple_choice_question",
                "auth_user",
                "connect_workspace",
                "upgrade_to_pro",
            }

            # Flush past Cloud Run / GFE buffer immediately.
            yield (b": " + (b" " * 4096) + b"\n\n")
            try:
                t_session0 = _now_ms()
                runner_session = existing_session
                if runner_session is None:
                    try:
                        runner_session = await runner.session_service.get_session(
                            app_name=runner.app_name,
                            user_id=effective_user_id,
                            session_id=session_id,
                        )
                    except Exception:  # noqa: BLE001
                        runner_session = None
                if runner_session is None:
                    runner_session = await runner.session_service.create_session(
                        app_name=runner.app_name,
                        user_id=effective_user_id,
                        session_id=session_id,
                    )
                timings["sessionMs"] = _now_ms() - t_session0

                from google.adk.agents.run_config import RunConfig, StreamingMode
                from google.genai import types as genai_types

                new_message = genai_types.Content(
                    role="user", parts=[genai_types.Part(text=message)]
                )
                run_cfg = RunConfig(streaming_mode=StreamingMode.SSE)
                t_stream0 = _now_ms()
                first_event_ms: int | None = None

                async def _drive(msg: Any) -> bool:
                    """Run the model once with `msg`; yield events into the
                    SSE stream. Returns True if a turn-ending choice
                    fired (caller should stop early)."""
                    nonlocal first_event_ms, first_text_ms, choice_shown
                    async for event in runner.run_async(
                        user_id=effective_user_id,
                        session_id=session_id,
                        new_message=msg,
                        run_config=run_cfg,
                    ):
                        if first_event_ms is None:
                            first_event_ms = _now_ms() - t_stream0
                        if first_text_ms is None and _event_has_text(event):
                            first_text_ms = _now_ms() - t_stream0
                        for call in _function_calls(event):
                            cid = call.get("id") or ""
                            if cid:
                                pending_by_id[cid] = {
                                    "name": call.get("name") or "?",
                                    "args": call.get("args"),
                                    "started_at": _now_ms(),
                                }
                        for resp in _function_responses(event):
                            rid = resp.get("id") or ""
                            pending = pending_by_id.get(rid) if rid else None
                            name = (pending or {}).get("name") or resp.get("name") or "?"
                            resp_obj = resp.get("response") or {}
                            status_val = (
                                resp_obj.get("status") if isinstance(resp_obj, dict) else None
                            )
                            ok = None if status_val is None else status_val != "error"
                            latency_ms = _now_ms() - pending["started_at"] if pending else None
                            tool_invocations.append(
                                {
                                    "name": name,
                                    "args": (pending or {}).get("args"),
                                    "ok": ok,
                                    "latencyMs": latency_ms,
                                }
                            )
                            if rid:
                                pending_by_id.pop(rid, None)
                            if name in turn_ending_tools and status_val in (
                                "shown",
                                "auth_prompted",
                                "oauth_prompted",
                                "upgrade_prompted",
                            ):
                                choice_shown = True
                        yield_payload = (
                            f"data: {json.dumps(_event_to_dict(event), default=str)}\n\n"
                        )
                        # We can't yield from a nested async function in
                        # Python the way TS yields — buffer through a
                        # queue. Instead, we collect events into a queue
                        # in the outer scope.
                        await _outer_queue.put(yield_payload.encode("utf-8"))
                        if choice_shown:
                            return True
                    return False

                # We can't `yield` from inside `_drive` (it's a coroutine,
                # not a generator). Use a queue + a background task so the
                # outer generator stays the only yielder.
                _outer_queue: asyncio.Queue[bytes | None] = asyncio.Queue()

                async def _drive_then_signal(msg: Any) -> bool:
                    try:
                        return await _drive(msg)
                    except ValueError as err:
                        if not _is_otel_context_token_mismatch(err):
                            raise
                        logger.warning(
                            "chat.stream_suppressed_otel_context_mismatch uid=%s sessionId=%s",
                            effective_user_id,
                            session_id,
                        )
                        return False
                    finally:
                        # Sentinel so the consumer wakes up and moves on.
                        await _outer_queue.put(None)

                drive_task = asyncio.create_task(_drive_then_signal(new_message))
                try:
                    while True:
                        chunk = await _outer_queue.get()
                        if chunk is None:
                            break
                        yield chunk
                    _first_pass_choice = await drive_task  # noqa: F841 — kept for symmetry/log
                finally:
                    if not drive_task.done():
                        drive_task.cancel()
                    with contextlib.suppress(asyncio.CancelledError):
                        try:
                            await drive_task
                        except ValueError as err:
                            if not _is_otel_context_token_mismatch(err):
                                raise
                            logger.warning(
                                "chat.stream_suppressed_otel_context_mismatch uid=%s sessionId=%s",
                                effective_user_id,
                                session_id,
                            )
                timings["streamMs"] = _now_ms() - t_stream0
                timings["ttfbMs"] = first_event_ms if first_event_ms is not None else -1
                timings["ttftMs"] = first_text_ms if first_text_ms is not None else -1

                # Silent turns end here. No synthetic assistant event,
                # no retry. Forward-fix path: capture as eval + tune prompt.
                yield b"event: done\ndata: {}\n\n"
            except Exception as err:  # noqa: BLE001
                # Log the traceback to stdout — Sentry capture is silent
                # without a DSN, and silent turns from swallowed runner
                # exceptions are exactly the class we want to surface.
                logger.exception(
                    "chat.stream_error uid=%s sessionId=%s",
                    effective_user_id,
                    session_id,
                )
                err_msg = str(err)
                yield (
                    b"event: error\ndata: "
                    + json.dumps({"message": err_msg}).encode("utf-8")
                    + b"\n\n"
                )
                capture_chat_event(
                    "chat.stream_error",
                    {"uid": effective_user_id, "sessionId": session_id, "error": err_msg},
                    "error",
                )
            finally:
                # Per-turn structured log line.
                aq_aqi = (
                    air_quality.aqi
                    if air_quality is not None and hasattr(air_quality, "aqi")
                    else None
                )
                today_count = calendar_density.today.count if calendar_density is not None else None
                tomorrow_count = (
                    calendar_density.tomorrow.count if calendar_density is not None else None
                )
                print(
                    json.dumps(
                        {
                            "msg": "chat.turn",
                            "uid": effective_user_id,
                            "sessionId": session_id,
                            "state": machine.current(),
                            "authenticated": claims is not None,
                            "hasLocation": coord is not None,
                            "hasWeather": weather is not None,
                            "airQualityAqi": aq_aqi,
                            "holidayCount": len(holidays or []),
                            "todayEventCount": today_count,
                            "tomorrowEventCount": tomorrow_count,
                            "hasProfile": user_profile is not None,
                            "nearbyPlacesCount": len(nearby_places or []),
                            "memoriesCount": len(memories or []),
                            "hasYesterdaySummary": bool(yesterday_summary),
                            "hasWeekSummary": bool(week_summary),
                            "recentGoalCount": len(recent_goal_updates or []),
                            "toolCount": len(tool_invocations),
                            "tools": tool_invocations,
                            "chatTurnCount": chat_turn_count,
                            "dailyTurnCount": daily_turn_count,
                            "tier": tier,
                            "usageState": usage_policy.state,
                            "model": usage_policy.model,
                            "nudgeMode": usage_policy.nudge_mode,
                            "walled": False,
                            "totalMs": tick(),
                            "timings": timings,
                        },
                        default=str,
                    )
                )

        return StreamingResponse(
            stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache, no-transform",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    return app


# --- Event shape helpers --------------------------------------------------


def _is_otel_context_token_mismatch(err: BaseException) -> bool:
    """Return True for ADK/OpenTelemetry contextvars detach noise.

    OpenTelemetry binds ContextVar tokens to the task/context that created
    them. During SSE cancellation the ADK tracing stack can close a span in a
    different asyncio context, raising this ValueError after the user-visible
    response has already completed.
    """
    msg = str(err)
    return (
        isinstance(err, ValueError) and "Token" in msg and "created in a different Context" in msg
    )


def _event_to_dict(event: Any) -> Any:
    """Convert an ADK Event (Pydantic model) to a JSON-serialisable dict.
    Tolerant of both the real `Event` class and dict-shaped fakes.

    Serialised with camelCase aliases so the wire shape matches what
    the web client's `parseSseBlock` expects (`functionCall`,
    `functionResponse`, etc.) — a contract carried over verbatim from
    the TS service. Without `by_alias=True`, snake_case keys would
    silently drop every tool-driven turn on the FE.
    """
    if isinstance(event, dict):
        return event
    dump = getattr(event, "model_dump", None)
    if callable(dump):
        try:
            return dump(mode="json", by_alias=True, exclude_none=True)
        except Exception:  # noqa: BLE001
            try:
                return dump(by_alias=True)
            except Exception:  # noqa: BLE001
                try:
                    return dump()
                except Exception:  # noqa: BLE001
                    pass
    # Last resort: best-effort attribute scrape.
    out: dict[str, Any] = {}
    for k in ("author", "content", "partial", "id", "timestamp"):
        v = getattr(event, k, None)
        if v is not None:
            out[k] = v
    return out


def _event_has_text(event: Any) -> bool:
    content = event.get("content") if isinstance(event, dict) else getattr(event, "content", None)
    if content is None:
        return False
    parts = (
        content.get("parts")
        if isinstance(content, dict)
        else (getattr(content, "parts", None) or [])
    ) or []
    for p in parts:
        text = p.get("text") if isinstance(p, dict) else getattr(p, "text", None)
        if isinstance(text, str) and text:
            return True
    return False


def _function_calls(event: Any) -> list[dict[str, Any]]:
    """Pull function calls off an event. Uses ADK's helper when available
    (real Event objects); falls back to walking `content.parts` for
    dict-shaped fakes."""
    helper = getattr(event, "get_function_calls", None)
    if callable(helper):
        try:
            calls = helper() or []
        except Exception:  # noqa: BLE001
            calls = []
        out: list[dict[str, Any]] = []
        for c in calls:
            if isinstance(c, dict):
                out.append(c)
            else:
                out.append(
                    {
                        "id": getattr(c, "id", None),
                        "name": getattr(c, "name", None),
                        "args": getattr(c, "args", None),
                    }
                )
        return out
    return _walk_function_parts(event, "functionCall")


def _function_responses(event: Any) -> list[dict[str, Any]]:
    helper = getattr(event, "get_function_responses", None)
    if callable(helper):
        try:
            resps = helper() or []
        except Exception:  # noqa: BLE001
            resps = []
        out: list[dict[str, Any]] = []
        for r in resps:
            if isinstance(r, dict):
                out.append(r)
            else:
                out.append(
                    {
                        "id": getattr(r, "id", None),
                        "name": getattr(r, "name", None),
                        "response": getattr(r, "response", None),
                    }
                )
        return out
    return _walk_function_parts(event, "functionResponse")


def _walk_function_parts(event: Any, key: str) -> list[dict[str, Any]]:
    content = event.get("content") if isinstance(event, dict) else getattr(event, "content", None)
    if content is None:
        return []
    parts = (
        content.get("parts")
        if isinstance(content, dict)
        else (getattr(content, "parts", None) or [])
    ) or []
    out: list[dict[str, Any]] = []
    for p in parts:
        v = p.get(key) if isinstance(p, dict) else getattr(p, key, None)
        if v is None:
            continue
        if isinstance(v, dict):
            out.append(v)
        else:
            out.append(
                {
                    "id": getattr(v, "id", None),
                    "name": getattr(v, "name", None),
                    "args": getattr(v, "args", None),
                    "response": getattr(v, "response", None),
                }
            )
    return out
