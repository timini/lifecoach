"""Production wiring for the Lifecoach agent.

Mirrors the bottom half of `apps/agent/src/server.ts` (the `main()` block):
construct real GCP clients, wire them into a `CreateAppDeps`, build the
runner factory, and start uvicorn.

Each external service is *only* constructed when its config is present,
so the binary can run with reduced functionality (no Workspace, no
memory) and surface clean log lines instead of crashing. The hard
required deps (Firestore, USER_BUCKET, Vertex creds for the Runner) are
checked up-front and abort startup with a clear message if missing.

`google-cloud-storage` isn't yet in `pyproject.toml`; the bucket adapter
is plugged in here behind the same `BucketLike` Protocol the storage
modules already expose, with a friendly error if the dep isn't
installed at runtime.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import httpx

from lifecoach_agent.agent import build_root_agent_for
from lifecoach_agent.auth import firebase_admin_verifier
from lifecoach_agent.context.air_quality import AirQualityClient
from lifecoach_agent.context.calendar_density import CalendarDensityClient
from lifecoach_agent.context.holidays import HolidaysClient
from lifecoach_agent.context.memory import (
    MemoryClient,
    create_vertex_memory_client,
    noop_memory_client,
)
from lifecoach_agent.context.places import PlacesClient
from lifecoach_agent.context.session_summarizer import (
    create_gemini_flash_lite_summarizer,
)
from lifecoach_agent.context.session_summary import SessionSummaryClient
from lifecoach_agent.context.weather import WeatherClient
from lifecoach_agent.oauth.workspace_client import (
    WorkspaceOAuthClient,
    create_workspace_oauth_client,
)
from lifecoach_agent.practices import get_enabled_practices
from lifecoach_agent.server import CreateAppDeps, RunnerForParams, SessionReader, create_app
from lifecoach_agent.storage.firestore_session import (
    FirestoreSessionService,
    create_firestore_session_service,
    save_session_summary,
)
from lifecoach_agent.storage.goal_updates import create_goal_updates_store
from lifecoach_agent.storage.profile_history import create_profile_history_store
from lifecoach_agent.storage.user_meta import create_user_meta_store
from lifecoach_agent.storage.user_profile import create_user_profile_store
from lifecoach_agent.storage.workspace_tokens import create_workspace_tokens_store
from lifecoach_agent.tools import (
    create_ask_multiple_choice_tool,
    create_ask_single_choice_tool,
    create_auth_user_tool,
    create_connect_workspace_tool,
    create_log_goal_update_tool,
    create_memory_save_tool,
    create_update_user_profile_tool,
    create_upgrade_to_pro_tool,
)
from lifecoach_agent.workspace_agent import (
    WorkspaceModuleDeps,
    create_workspace_tools,
)

APP_NAME = "lifecoach"
log = logging.getLogger("lifecoach_agent.main")


def _require_env(name: str) -> str:
    val = os.environ.get(name)
    if not val:
        raise RuntimeError(f"required env var {name!r} is not set")
    return val


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    try:
        return int(raw)
    except ValueError as err:
        raise RuntimeError(f"env var {name!r} must be an integer") from err


def _utc_now() -> datetime:
    return datetime.now(ZoneInfo("UTC"))


def _build_real_firestore() -> Any:
    """Build a `FirestoreLike` adapter over `google.cloud.firestore.AsyncClient`.
    The adapter trims the surface to just `doc()` and `collection()` —
    matching the Protocol in `storage.firestore_session`.
    """
    from google.cloud import firestore

    client = firestore.AsyncClient()
    # The async client implements `document()` not `doc()`, and its
    # snapshots expose `to_dict()` not `data()` (and a collection get
    # returns a list of snapshots, not a wrapper with `.docs`). The
    # storage layer's Protocol mirrors the JS-firestore-admin shape.
    # Bridge both calls + snapshot accessors here.

    class _DocSnapAdapter:
        def __init__(self, snap: Any) -> None:
            self._snap = snap

        @property
        def exists(self) -> bool:
            return bool(self._snap.exists)

        def data(self) -> dict[str, Any] | None:
            d = self._snap.to_dict()
            return d if d is None else dict(d)

    class _CollSnapAdapter:
        def __init__(self, items: Any) -> None:
            self._items = list(items)

        @property
        def docs(self) -> list[Any]:
            return [_DocSnapAdapter(d) for d in self._items]

    class _DocAdapter:
        def __init__(self, ref: Any) -> None:
            self._ref = ref

        async def get(self) -> Any:
            return _DocSnapAdapter(await self._ref.get())

        async def set(self, value: dict[str, Any], *, merge: bool = False) -> Any:
            return await self._ref.set(value, merge=merge)

        async def delete(self) -> Any:
            return await self._ref.delete()

    class _CollectionAdapter:
        def __init__(self, ref: Any) -> None:
            self._ref = ref

        async def get(self) -> Any:
            return _CollSnapAdapter(await self._ref.get())

    class _FsAdapter:
        def doc(self, path: str) -> Any:
            return _DocAdapter(client.document(path))

        def collection(self, path: str) -> Any:
            return _CollectionAdapter(client.collection(path))

    return _FsAdapter()


def _build_real_bucket() -> Any:
    """Build a `BucketLike` over `google-cloud-storage`. The package
    isn't yet a hard dependency in `pyproject.toml`; the import is
    deferred so the rest of the binary loads when storage is unused
    (e.g. an agent that runs without GCS-backed user data)."""
    bucket_name = _require_env("USER_BUCKET")
    try:
        # Deferred import — google-cloud-storage is not yet a hard
        # dependency in pyproject.toml. Treated as Any to keep mypy
        # happy without a type stub on a soft dep.
        from google.cloud import storage as _storage_mod  # type: ignore[attr-defined]
    except ImportError as err:
        raise RuntimeError(
            "google-cloud-storage is not installed; add it to pyproject.toml dependencies "
            "before running with USER_BUCKET set."
        ) from err

    storage: Any = _storage_mod
    client = storage.Client()
    bucket = client.bucket(bucket_name)

    # The sync google-cloud-storage `Blob` doesn't satisfy our async
    # `BucketFile`. Wrap each call in a thread to keep the storage
    # surface async without pulling in another dep.
    import asyncio

    class _BlobAdapter:
        def __init__(self, blob: Any) -> None:
            self._blob = blob

        async def download(self) -> bytes:
            from lifecoach_agent.storage.user_profile import NotFoundError

            def _do() -> bytes:
                if not self._blob.exists():
                    raise NotFoundError(self._blob.name)
                data: bytes = self._blob.download_as_bytes()
                return data

            return await asyncio.to_thread(_do)

        async def save(
            self, contents: str | bytes, content_type: str = "application/octet-stream"
        ) -> None:
            def _do() -> None:
                if isinstance(contents, bytes):
                    self._blob.upload_from_string(contents, content_type=content_type)
                else:
                    self._blob.upload_from_string(contents, content_type=content_type)

            await asyncio.to_thread(_do)

        async def exists(self) -> bool:
            return await asyncio.to_thread(self._blob.exists)

    class _BucketAdapter:
        def file(self, path: str) -> Any:
            return _BlobAdapter(bucket.blob(path))

    return _BucketAdapter()


def _build_places_token_provider() -> Any:
    """ADC-sourced bearer-token provider for the Google Places API."""
    from google.auth import default as google_auth_default
    from google.auth.transport.requests import (
        Request as GoogleAuthRequest,
    )

    creds, _project = google_auth_default(scopes=["https://www.googleapis.com/auth/cloud-platform"])

    async def provide() -> str | None:
        import asyncio

        def _refresh() -> str | None:
            if not creds.valid:
                # google-auth's Credentials.refresh isn't typed.
                creds.refresh(GoogleAuthRequest())  # type: ignore[no-untyped-call]
            token: Any = getattr(creds, "token", None)
            return token if isinstance(token, str) else None

        return await asyncio.to_thread(_refresh)

    return provide


def _build_calendar_events_fetcher() -> Any:
    """Wrap `google-api-python-client` for the calendar density module."""
    import asyncio

    def _build_service(access_token: str) -> Any:
        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build  # type: ignore[import-untyped]

        # Credentials.__init__ has untyped kwargs.
        creds = Credentials(token=access_token)  # type: ignore[no-untyped-call]
        return build("calendar", "v3", credentials=creds, cache_discovery=False)

    async def fetch(
        access_token: str, calendar_id: str, time_min: str, time_max: str
    ) -> list[dict[str, Any]] | None:
        def _do() -> list[dict[str, Any]] | None:
            try:
                svc = _build_service(access_token)
                resp = (
                    svc.events()
                    .list(
                        calendarId=calendar_id,
                        timeMin=time_min,
                        timeMax=time_max,
                        singleEvents=True,
                        orderBy="startTime",
                        maxResults=50,
                    )
                    .execute()
                )
                items = resp.get("items") or []
                if isinstance(items, list):
                    return items
                return None
            except Exception:  # noqa: BLE001
                return None

        return await asyncio.to_thread(_do)

    return fetch


def build_app() -> Any:
    """Wire together the FastAPI app + Runner factory for production."""
    firestore = _build_real_firestore()
    session_service: FirestoreSessionService = create_firestore_session_service(firestore=firestore)

    bucket = _build_real_bucket()
    profile_store = create_user_profile_store(bucket=bucket)
    profile_history_store = create_profile_history_store(bucket=bucket)
    goal_updates_store = create_goal_updates_store(bucket=bucket)

    weather = WeatherClient()
    air_quality = AirQualityClient()
    holidays = HolidaysClient()

    # Workspace OAuth — only enabled when both env vars are set.
    ws_client_id = os.environ.get("GWS_OAUTH_CLIENT_ID")
    ws_client_secret = os.environ.get("GWS_OAUTH_CLIENT_SECRET")
    workspace_enabled = bool(ws_client_id and ws_client_secret)
    workspace_oauth_client: WorkspaceOAuthClient | None = None
    workspace_tokens_store = None
    if workspace_enabled:
        workspace_oauth_client = create_workspace_oauth_client(
            client_id=ws_client_id or "",
            client_secret=ws_client_secret or "",
            http=httpx.AsyncClient(timeout=10.0),
        )
        workspace_tokens_store = create_workspace_tokens_store(
            firestore=firestore, oauth_client=workspace_oauth_client
        )
    else:
        print(
            '{"msg":"workspace.disabled","reason":'
            '"GWS_OAUTH_CLIENT_ID / GWS_OAUTH_CLIENT_SECRET not set"}'
        )

    calendar_density: CalendarDensityClient | None = None
    if workspace_tokens_store is not None:
        calendar_density = CalendarDensityClient(
            store=workspace_tokens_store,
            events_fetcher=_build_calendar_events_fetcher(),
        )

    user_meta_store = create_user_meta_store(firestore=firestore)

    places = PlacesClient()
    places_token_provider = _build_places_token_provider()

    # Long-term memory via Vertex Memory Bank — opt-in via env.
    memory: MemoryClient
    project = os.environ.get("LIFECOACH_VERTEX_PROJECT")
    location = os.environ.get("LIFECOACH_VERTEX_LOCATION")
    agent_engine = os.environ.get("LIFECOACH_AGENT_ENGINE_ID")
    memory_enabled = bool(project and location and agent_engine)
    if memory_enabled:
        memory = create_vertex_memory_client(
            project=project or "",
            location=location or "",
            agent_engine_id=agent_engine or "",
            app_name=APP_NAME,
        )
    else:
        memory = noop_memory_client()
        print(
            '{"msg":"memory.disabled","reason":'
            '"LIFECOACH_VERTEX_PROJECT / LIFECOACH_VERTEX_LOCATION / '
            'LIFECOACH_AGENT_ENGINE_ID not set"}'
        )

    # Yesterday + week summaries.
    class _SessionSummaryStoreAdapter:
        app_name: str = APP_NAME

        async def get_session(self, *, app_name: str, user_id: str, session_id: str) -> Any:
            data = await session_service.get_session(
                app_name=app_name, user_id=user_id, session_id=session_id
            )
            if data is None:
                return None
            # The summary client reads `state` and `events` attributes.
            return type(
                "SessionView",
                (),
                {"state": data.get("state", {}), "events": data.get("events", [])},
            )()

        async def save_summary(
            self,
            *,
            app_name: str,
            user_id: str,
            session_id: str,
            summary: str,
            generated_at: int,
        ) -> None:
            await save_session_summary(
                firestore=firestore,
                app_name=app_name,
                user_id=user_id,
                session_id=session_id,
                summary=summary,
                generated_at=generated_at,
            )

    session_summary = SessionSummaryClient(
        store=_SessionSummaryStoreAdapter(),
        summarizer=create_gemini_flash_lite_summarizer(),
    )

    # Runner factory --------------------------------------------------
    def runner_for(params: RunnerForParams) -> Any:  # RunnerLike, structurally
        from google.adk.runners import Runner

        ctx = params.ctx
        uid = params.uid
        usage_policy = params.usage_policy

        tools: list[Any] = [
            create_update_user_profile_tool(
                store=profile_store, uid=uid, history=profile_history_store
            ),
            create_log_goal_update_tool(store=goal_updates_store, uid=uid),
            create_ask_single_choice_tool(),
            create_ask_multiple_choice_tool(),
        ]
        # `auth_user` is in `policies.CORE_TOOLS` — declared always-available.
        # Originally only registered for `anonymous`, but the WORKSPACE-ASK
        # TRIGGER (issue #62 / PR #63) routes `email_pending` and
        # `email_verified` users to `auth_user({mode:"google"})` when they ask
        # for workspace ops. They can't grant Workspace scopes without first
        # signing in via Google, and `auth_user` is the only path. Codex P2
        # caught this gap on PR #63. Registering for all four pre-`google_linked`
        # states matches the policy spec and the trigger directive. For
        # `google_linked`/`workspace_connected` the tool stays unregistered —
        # they're already signed in and a re-trigger would just confuse.
        if ctx.user_state in ("anonymous", "email_pending", "email_verified"):
            tools.append(create_auth_user_tool())
        if memory_enabled:
            tools.append(create_memory_save_tool(client=memory, uid=uid))
        if workspace_enabled and ctx.user_state in ("google_linked", "workspace_connected"):
            tools.append(create_connect_workspace_tool())
        if (
            workspace_enabled
            and workspace_tokens_store is not None
            and ctx.user_state == "workspace_connected"
        ):
            tools.extend(
                create_workspace_tools(WorkspaceModuleDeps(store=workspace_tokens_store, uid=uid))
            )
        if usage_policy.upgrade_tool_available:
            tools.append(create_upgrade_to_pro_tool())
        # Practices contribute their own tools (e.g. log_gratitude).
        for practice in get_enabled_practices(ctx.user_profile):
            if practice.tools is None:
                continue
            from lifecoach_agent.practices.types import PracticeDeps

            deps = PracticeDeps(profile_store=profile_store)
            for ptool in practice.tools(deps, uid):
                tools.append(ptool)

        agent = build_root_agent_for(ctx, tools, model=usage_policy.model)
        # `FirestoreSessionService` doesn't yet subclass ADK's
        # `BaseSessionService` — that landing is tracked alongside the
        # Phase 9 cutover. The runtime contract (duck-typed by ADK) is
        # already satisfied; the typed return is `Any`/RunnerLike since
        # `Runner.session_service` is concretely typed and conflicts.
        runner: Any = Runner(
            app_name=APP_NAME,
            agent=agent,
            session_service=session_service,  # type: ignore[arg-type]
        )
        return runner

    class _SessionReaderAdapter(SessionReader):
        app_name: str = APP_NAME

        async def get_session(self, *, app_name: str, user_id: str, session_id: str) -> Any | None:
            return await session_service.get_session(
                app_name=app_name, user_id=user_id, session_id=session_id
            )

        async def list_sessions(self, *, app_name: str, user_id: str) -> list[Any]:
            return await session_service.list_sessions(app_name=app_name, user_id=user_id)

    deps = CreateAppDeps(
        runner_for=runner_for,
        session_reader=_SessionReaderAdapter(),
        verify_token=firebase_admin_verifier(),
        # Default closed: the web app already obtains Firebase anonymous ID
        # tokens before chat, so unauthenticated agent calls should not reach
        # billable LLM execution unless explicitly disabled for local/dev.
        require_auth=os.environ.get("REQUIRE_AUTH", "true") != "false",
        internal_bearer=os.environ.get("AGENT_INTERNAL_BEARER") or None,
        free_anonymous_turn_limit=_env_int("FREE_ANONYMOUS_TURN_LIMIT", 25),
        free_signed_in_turn_limit=_env_int("FREE_SIGNED_IN_TURN_LIMIT", 100),
        weather=weather,
        places=places,
        places_token_provider=places_token_provider,
        air_quality=air_quality,
        holidays=holidays,
        calendar_density=calendar_density,
        memory=memory,
        memory_enabled=memory_enabled,
        session_summary=session_summary,
        profile_store=profile_store,
        profile_history_store=profile_history_store,
        goal_updates_store=goal_updates_store,
        workspace_tokens_store=workspace_tokens_store,
        workspace_oauth_client=workspace_oauth_client,
        user_meta_store=user_meta_store,
        now=_utc_now,
    )

    return create_app(deps)


def main() -> None:
    """Boot uvicorn against `build_app()`."""
    import uvicorn

    from lifecoach_agent.sentry_setup import init_sentry

    init_sentry()
    app = build_app()
    port = int(os.environ.get("PORT", "8080"))
    log.info("[lifecoach-agent] listening on :%d", port)
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")


if __name__ == "__main__":  # pragma: no cover
    main()
