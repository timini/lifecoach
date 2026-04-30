import {
  type Event,
  type RunConfig,
  type Session,
  StreamingMode,
  getFunctionCalls,
  getFunctionResponses,
} from '@google/adk';
import type { Content } from '@google/genai';
import { type UsagePolicy, UsageStateMachine, UserStateMachine } from '@lifecoach/user-state';
import express, { type Express, type Request, type Response } from 'express';
import {
  type TokenVerifier,
  type VerifiedClaims,
  claimsToFirebaseUserLike,
  verifyRequest,
} from './auth.js';
import { makeRecoveryEvent, pickRecoveryText } from './chat/emptyTurnGuard.js';
import type { AirQualityClient } from './context/airQuality.js';
import type { CalendarDensityClient } from './context/calendarDensity.js';
import type { HolidaysClient } from './context/holidays.js';
import type { MemoryClient } from './context/memory.js';
import type { PlacesClient } from './context/places.js';
import type { Coord, WeatherClient } from './context/weather.js';
import type { WorkspaceOAuthClient } from './oauth/workspaceClient.js';
import { getEnabledPractices } from './practices/index.js';
import type { InstructionContext, LocationCtx } from './prompt/buildInstruction.js';
import type { GoalUpdatesStore } from './storage/goalUpdates.js';
import type { UserMetaStore } from './storage/userMeta.js';
import type { UserProfileStore } from './storage/userProfile.js';
import type { WorkspaceTokensStore } from './storage/workspaceTokens.js';

/**
 * Minimal surface of the ADK Runner that we depend on. Lets tests pass a fake
 * without pulling in the real LLM / session machinery.
 */
export interface RunnerLike {
  appName: string;
  sessionService: {
    createSession(params: {
      appName: string;
      userId: string;
      sessionId: string;
    }): Promise<Session>;
    getSession(params: {
      appName: string;
      userId: string;
      sessionId: string;
    }): Promise<Session | null>;
    /**
     * Optional — used by the empty-turn guard to persist a synthetic
     * recovery event when the model returns tool calls without text.
     * Optional so existing test fakes don't have to implement it.
     */
    appendEvent?(params: { session: Session; event: Event }): Promise<Event>;
  };
  runAsync(params: {
    userId: string;
    sessionId: string;
    newMessage: Content;
    runConfig?: RunConfig;
  }): AsyncGenerator<Event, void, undefined>;
}

export interface RunnerForParams {
  ctx: InstructionContext;
  uid: string;
  /**
   * Usage policy for this turn — drives model selection (e.g. Flash Lite
   * for free_throttled anonymous users) and conditional registration of
   * the upgrade_to_pro tool. Computed by the /chat handler from
   * UsageStateMachine before calling this factory.
   */
  usagePolicy: UsagePolicy;
}

export interface SessionReader {
  appName: string;
  getSession(params: {
    appName: string;
    userId: string;
    sessionId: string;
  }): Promise<Session | null | undefined>;
  /**
   * Optional — drives the GET /sessions endpoint that powers the sidebar.
   * Returns metadata-only sessions (no events) sorted by `lastUpdateTime`
   * descending. Falls back to an empty list if the reader doesn't expose
   * this (older / test fakes).
   */
  listSessions?(params: { appName: string; userId: string }): Promise<{ sessions: Session[] }>;
}

export interface CreateAppDeps {
  /**
   * Factory invoked per request with the turn's InstructionContext + uid.
   * The server builds the context, the factory builds a Runner with a
   * fresh LlmAgent wired to the shared session service and a uid-scoped
   * update_user_profile tool.
   */
  runnerFor: (params: RunnerForParams) => RunnerLike;
  /**
   * Optional read-only handle to the session store for the /history
   * endpoint. Defaults are derived from the runnerFor's runner at request
   * time when omitted.
   */
  sessionReader?: SessionReader;
  verifyToken?: TokenVerifier;
  requireAuth?: boolean;
  weather?: WeatherClient;
  places?: PlacesClient;
  airQuality?: AirQualityClient;
  holidays?: HolidaysClient;
  calendarDensity?: CalendarDensityClient;
  memory?: MemoryClient;
  profileStore?: UserProfileStore;
  goalUpdatesStore?: GoalUpdatesStore;
  workspaceTokensStore?: WorkspaceTokensStore;
  workspaceOAuthClient?: WorkspaceOAuthClient;
  /**
   * Per-uid usage meta (chat turn count, tier). Optional only because the
   * test app sometimes runs without it; in production it's always set so
   * the UsageStateMachine can derive a real policy.
   */
  userMetaStore?: UserMetaStore;
  now?: () => Date;
}

/**
 * Wrap a promise with a stopwatch. Used to record per-fetch latencies in the
 * /chat parallel block (weather/places/etc) so the chat.turn log shows which
 * branch dominated the prep phase.
 */
async function timed<T>(p: Promise<T>): Promise<[T, number]> {
  const t0 = Date.now();
  const v = await p;
  return [v, Date.now() - t0];
}

/**
 * True when this session already contains at least one *real* user message
 * — i.e. anything beyond the synthetic `__session_start__` kickoff. Drives
 * DailyFlowMachine's morning_greeting → morning flip.
 */
function sessionHasUserInteraction(session: Session | null | undefined): boolean {
  if (!session) return false;
  for (const ev of session.events ?? []) {
    if (ev.author !== 'user') continue;
    const parts = ev.content?.parts ?? [];
    const text = parts
      .map((p) => (typeof p.text === 'string' ? p.text : ''))
      .join('')
      .trim();
    if (text && text !== '__session_start__') return true;
  }
  return false;
}

interface ChatBody {
  userId?: string;
  sessionId?: string;
  message?: string;
  location?: { lat: number; lng: number; accuracy?: number };
  timezone?: string;
}

export function createApp(deps: CreateAppDeps): Express {
  const app = express();
  app.use(express.json({ limit: '256kb' }));
  const now = deps.now ?? (() => new Date());

  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok' });
  });

  // GET /history?userId=...&sessionId=...  →  { events: Event[] }
  // Lets the web app rehydrate the chat UI on reload. Token-verified uid
  // overrides the query uid to prevent cross-user reads.
  app.get('/history', async (req: Request, res: Response) => {
    const { userId, sessionId } = req.query as { userId?: string; sessionId?: string };
    if (!userId || !sessionId) {
      res.status(400).json({ error: 'userId and sessionId are required' });
      return;
    }
    let claims: VerifiedClaims | null = null;
    if (deps.verifyToken) {
      claims = await verifyRequest(
        { authorization: req.header('authorization') ?? undefined },
        deps.verifyToken,
      );
    }
    if (deps.requireAuth && !claims) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    const effectiveUserId = claims?.uid ?? userId;

    const reader = deps.sessionReader;
    if (!reader) {
      res.status(200).json({ events: [] });
      return;
    }
    const session = await reader
      .getSession({ appName: reader.appName, userId: effectiveUserId, sessionId })
      .catch(() => null);
    res.status(200).json({ events: session?.events ?? [] });
  });

  // GET /sessions  →  { sessions: Array<{ sessionId, lastUpdateTime }> }
  // Metadata-only listing (no events) for the sidebar drawer. Sorted by
  // lastUpdateTime descending so the most recent appears first. The
  // Bearer-verified uid scopes the read; the request body is empty.
  app.get('/sessions', async (req: Request, res: Response) => {
    let claims: VerifiedClaims | null = null;
    if (deps.verifyToken) {
      claims = await verifyRequest(
        { authorization: req.header('authorization') ?? undefined },
        deps.verifyToken,
      );
    }
    if (deps.requireAuth && !claims) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    const effectiveUserId = claims?.uid;
    if (!effectiveUserId) {
      // Without auth there's no uid to scope the listing — return empty.
      res.status(200).json({ sessions: [] });
      return;
    }

    const reader = deps.sessionReader;
    if (!reader || !reader.listSessions) {
      res.status(200).json({ sessions: [] });
      return;
    }
    const result = await reader
      .listSessions({ appName: reader.appName, userId: effectiveUserId })
      .catch(() => ({ sessions: [] as Session[] }));
    const sessions = result.sessions
      .map((s) => ({
        sessionId: s.id,
        lastUpdateTime: s.lastUpdateTime ?? 0,
      }))
      .sort((a, b) => b.lastUpdateTime - a.lastUpdateTime);
    res.status(200).json({ sessions });
  });

  // GET /profile?userId=...  →  { profile: Record<string, unknown> }
  // PATCH /profile           →  body { profile } → writes the whole doc.
  // Bearer-verified uid overrides the query uid so one user can't read or
  // overwrite another's profile.
  app.get('/profile', async (req: Request, res: Response) => {
    const { userId } = req.query as { userId?: string };
    if (!userId) {
      res.status(400).json({ error: 'userId is required' });
      return;
    }
    let claims: VerifiedClaims | null = null;
    if (deps.verifyToken) {
      claims = await verifyRequest(
        { authorization: req.header('authorization') ?? undefined },
        deps.verifyToken,
      );
    }
    if (deps.requireAuth && !claims) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    const effectiveUserId = claims?.uid ?? userId;
    if (!deps.profileStore) {
      res.status(200).json({ profile: {} });
      return;
    }
    const profile = await deps.profileStore.read(effectiveUserId).catch(() => ({}));
    res.status(200).json({ profile });
  });

  app.patch(
    '/profile',
    async (req: Request<unknown, unknown, { profile?: unknown }>, res: Response) => {
      const body = req.body ?? {};
      const profile = body.profile;
      if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
        res.status(400).json({ error: 'body.profile must be an object' });
        return;
      }
      let claims: VerifiedClaims | null = null;
      if (deps.verifyToken) {
        claims = await verifyRequest(
          { authorization: req.header('authorization') ?? undefined },
          deps.verifyToken,
        );
      }
      if (!claims) {
        // Unlike /chat which accepts anonymous UIDs in the body, direct
        // profile writes require a verified token so a malicious client
        // can't overwrite an arbitrary UID's data.
        res.status(401).json({ error: 'unauthenticated' });
        return;
      }
      const effectiveUserId = claims.uid;
      if (!deps.profileStore) {
        res.status(503).json({ error: 'profile store not configured' });
        return;
      }
      await deps.profileStore.write(effectiveUserId, profile as Record<string, unknown>);
      res.status(200).json({ status: 'ok' });
    },
  );

  // GET /goals?userId=...  →  { updates: GoalUpdate[] } (last 20)
  app.get('/goals', async (req: Request, res: Response) => {
    const { userId } = req.query as { userId?: string };
    if (!userId) {
      res.status(400).json({ error: 'userId is required' });
      return;
    }
    let claims: VerifiedClaims | null = null;
    if (deps.verifyToken) {
      claims = await verifyRequest(
        { authorization: req.header('authorization') ?? undefined },
        deps.verifyToken,
      );
    }
    if (deps.requireAuth && !claims) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    const effectiveUserId = claims?.uid ?? userId;
    if (!deps.goalUpdatesStore) {
      res.status(200).json({ updates: [] });
      return;
    }
    const updates = await deps.goalUpdatesStore.recent(effectiveUserId, 20).catch(() => []);
    res.status(200).json({ updates });
  });

  // -------------------------------------------------------------------------
  // Workspace OAuth endpoints — owned entirely by the application.
  // The LLM never sees codes, tokens, or secrets handled here.
  // -------------------------------------------------------------------------

  // POST /workspace/oauth-exchange   body:{code}
  //   Requires Bearer. Exchanges the GIS-popup auth code for {access_token,
  //   refresh_token, expiry} via OAuth2Client and stores in Firestore.
  //   Never echoes any token back to the client.
  app.post(
    '/workspace/oauth-exchange',
    async (req: Request<unknown, unknown, { code?: unknown }>, res: Response) => {
      const code = typeof req.body?.code === 'string' ? req.body.code : '';
      if (!code) {
        res.status(400).json({ error: 'body.code (string) is required' });
        return;
      }
      let claims: VerifiedClaims | null = null;
      if (deps.verifyToken) {
        claims = await verifyRequest(
          { authorization: req.header('authorization') ?? undefined },
          deps.verifyToken,
        );
      }
      if (!claims) {
        res.status(401).json({ error: 'unauthenticated' });
        return;
      }
      if (!deps.workspaceOAuthClient || !deps.workspaceTokensStore) {
        res.status(503).json({ error: 'workspace not configured' });
        return;
      }
      try {
        const tokens = await deps.workspaceOAuthClient.exchangeCode(code);
        const stored = await deps.workspaceTokensStore.set(claims.uid, tokens);
        res.status(200).json({
          connected: true,
          scopes: stored.scopes,
          grantedAt: stored.grantedAt,
        });
      } catch (err) {
        // Never echo the raw error body — it might contain the code.
        const message = err instanceof Error ? err.message : 'exchange failed';
        // eslint-disable-next-line no-console
        console.log(
          JSON.stringify({
            msg: 'workspace.oauth_exchange_failed',
            uid: claims.uid,
            // Message sanitised — we know our own thrown errors here, but
            // guard against a future refactor leaking raw OAuth errors.
            reason: message.replace(/ya29\.[^\s]+/g, '[redacted]').slice(0, 200),
          }),
        );
        res.status(400).json({ error: 'oauth_exchange_failed' });
      }
    },
  );

  // GET /workspace/status   (no body)
  //   Returns {connected, scopes, grantedAt}. Never includes token values.
  app.get('/workspace/status', async (req: Request, res: Response) => {
    let claims: VerifiedClaims | null = null;
    if (deps.verifyToken) {
      claims = await verifyRequest(
        { authorization: req.header('authorization') ?? undefined },
        deps.verifyToken,
      );
    }
    if (!claims) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    if (!deps.workspaceTokensStore) {
      res.status(200).json({ connected: false, scopes: [], grantedAt: null });
      return;
    }
    const doc = await deps.workspaceTokensStore.get(claims.uid).catch(() => null);
    if (!doc) {
      res.status(200).json({ connected: false, scopes: [], grantedAt: null });
      return;
    }
    res.status(200).json({ connected: true, scopes: doc.scopes, grantedAt: doc.grantedAt });
  });

  // DELETE /workspace
  //   Best-efforts revokeToken at Google, then deletes the Firestore doc.
  app.delete('/workspace', async (req: Request, res: Response) => {
    let claims: VerifiedClaims | null = null;
    if (deps.verifyToken) {
      claims = await verifyRequest(
        { authorization: req.header('authorization') ?? undefined },
        deps.verifyToken,
      );
    }
    if (!claims) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    if (!deps.workspaceTokensStore) {
      res.status(200).json({ connected: false, scopes: [], grantedAt: null });
      return;
    }
    const existing = await deps.workspaceTokensStore.get(claims.uid).catch(() => null);
    if (existing && deps.workspaceOAuthClient) {
      await deps.workspaceOAuthClient
        .revokeRefreshToken(existing.refreshToken)
        .catch(() => undefined);
    }
    await deps.workspaceTokensStore.delete(claims.uid).catch(() => undefined);
    res.status(200).json({ connected: false, scopes: [], grantedAt: null });
  });

  app.post('/chat', async (req: Request<unknown, unknown, ChatBody>, res: Response) => {
    const { userId, sessionId, message, location, timezone } = req.body ?? {};
    if (!userId || !sessionId || !message) {
      res.status(400).json({ error: 'userId, sessionId, and message are required' });
      return;
    }

    // Per-turn timing instrumentation. Each `timed(fn)` returns [value, ms];
    // we accumulate ms-fields under `timings` for the chat.turn log line so
    // we can spot which phase is slow (auth, parallel fetches, profile read,
    // memory search, runner stream, individual tool calls).
    const t0 = Date.now();
    const timings: Record<string, number> = {};
    const tick = () => Date.now() - t0;

    const tAuth0 = Date.now();
    let claims: VerifiedClaims | null = null;
    if (deps.verifyToken) {
      claims = await verifyRequest(
        { authorization: req.header('authorization') ?? undefined },
        deps.verifyToken,
      );
    }
    timings.authMs = Date.now() - tAuth0;
    if (deps.requireAuth && !claims) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    const effectiveUserId = claims?.uid ?? userId;

    // Compute workspaceScopesGranted from the Firestore doc — no LLM
    // involvement, no token in context. Presence of a non-empty refresh
    // token is enough; the tool handler does the expiry-and-refresh check
    // lazily when actually called.
    const tWsGrant0 = Date.now();
    let workspaceScopesGranted = false;
    if (claims && deps.workspaceTokensStore) {
      try {
        const doc = await deps.workspaceTokensStore.get(effectiveUserId);
        workspaceScopesGranted = Boolean(doc?.refreshToken);
      } catch {
        workspaceScopesGranted = false;
      }
    }
    timings.wsGrantMs = Date.now() - tWsGrant0;

    const machine = claims
      ? UserStateMachine.fromFirebaseUser(claimsToFirebaseUserLike(claims, workspaceScopesGranted))
      : new UserStateMachine('anonymous');

    // Fetch all per-turn context in ONE parallel block. None of these depend
    // on each other and they were previously partly sequential — that cost
    // ~900ms unnecessarily on every turn. Each provider is cached
    // per-region (or per-uid for calendar density), so identical inputs
    // across turns hit memory rather than upstream. Calendar density is
    // only fetched when the user is workspace_connected — otherwise we
    // have no token to use.
    const coord: Coord | null = location ? { lat: location.lat, lng: location.lng } : null;
    // Country code from IANA timezone — not from coord (no reverse-geocode).
    // Unmapped timezone → no holidays block (graceful).
    const { tzToCountry } = await import('./context/holidays.js');
    const countryCode = tzToCountry(timezone ?? null);
    const wantCalendarDensity =
      machine.current() === 'workspace_connected' && deps.calendarDensity && timezone;
    const tParallel0 = Date.now();
    const [
      [weather, weatherMs],
      [nearbyPlaces, placesMs],
      [airQuality, airQualityMs],
      [holidays, holidaysMs],
      [calendarDensity, calendarDensityMs],
      [userProfile, profileMs],
      [recentGoalUpdates, goalsMs],
      [memories, memoryMs],
      [meta, metaMs],
      [existingSession],
    ] = await Promise.all([
      timed(
        coord && deps.weather ? deps.weather.get(coord).catch(() => null) : Promise.resolve(null),
      ),
      timed(
        coord && deps.places
          ? deps.places.get(coord).catch(() => undefined)
          : Promise.resolve(undefined),
      ),
      timed(
        coord && deps.airQuality
          ? deps.airQuality.get(coord).catch(() => null)
          : Promise.resolve(null),
      ),
      timed(
        countryCode && deps.holidays
          ? deps.holidays.next7Days(countryCode).catch(() => [])
          : Promise.resolve([]),
      ),
      timed(
        wantCalendarDensity
          ? (deps.calendarDensity as CalendarDensityClient)
              .get({ uid: effectiveUserId, timezone: timezone as string, now: now() })
              .catch(() => null)
          : Promise.resolve(null),
      ),
      timed(
        deps.profileStore
          ? deps.profileStore.read(effectiveUserId).catch(() => undefined)
          : Promise.resolve(undefined),
      ),
      timed(
        deps.goalUpdatesStore
          ? deps.goalUpdatesStore.recent(effectiveUserId, 20).catch(() => undefined)
          : Promise.resolve(undefined),
      ),
      timed(
        // Silent memory retrieval — searched with the user's current message
        // as the query. Any error yields an empty list; never fails a turn.
        deps.memory
          ? deps.memory.search(effectiveUserId, message, 5).catch(() => [])
          : Promise.resolve([]),
      ),
      timed(
        // Increments the per-uid chat counter and reads the stored tier.
        // Counter failure should never block a turn; on error we get
        // {chatTurnCount:0, tier:'free'} defaults via .catch().
        deps.userMetaStore
          ? deps.userMetaStore
              .incrementTurnCount(effectiveUserId)
              .catch(() => ({ chatTurnCount: 0, tier: 'free' as const }))
          : Promise.resolve({ chatTurnCount: 0, tier: 'free' as const }),
      ),
      timed(
        // Pre-fetch this session's events so DailyFlowMachine can decide
        // morning_greeting vs morning. Reused later in the runner branch
        // when deciding whether to seed a new session doc.
        deps.sessionReader
          ? deps.sessionReader
              .getSession({
                appName: deps.sessionReader.appName,
                userId: effectiveUserId,
                sessionId,
              })
              .catch(() => null)
          : Promise.resolve(null),
      ),
    ]);
    timings.parallelMs = Date.now() - tParallel0;
    timings.weatherMs = weatherMs;
    timings.placesMs = placesMs;
    timings.airQualityMs = airQualityMs;
    timings.holidaysMs = holidaysMs;
    timings.calendarDensityMs = calendarDensityMs;
    timings.profileMs = profileMs;
    timings.goalsMs = goalsMs;
    timings.memoryMs = memoryMs;
    timings.metaMs = metaMs;
    const locationCtx: LocationCtx | null = coord ? { coord } : null;
    const chatTurnCount = meta.chatTurnCount;
    const tier = meta.tier;
    timings.prepMs = tick();
    const usagePolicy = UsageStateMachine.from({
      userState: machine.current(),
      chatCount: chatTurnCount,
      tier,
    }).policy();

    const hasInteractedToday = sessionHasUserInteraction(existingSession ?? null);

    const instructionCtx: InstructionContext = {
      now: now(),
      timezone: timezone ?? null,
      userState: machine.current(),
      location: locationCtx,
      weather,
      airQuality,
      holidays,
      calendarDensity,
      userProfile,
      recentGoalUpdates,
      nearbyPlaces,
      memories,
      nudgeMode: usagePolicy.nudgeMode,
      hasInteractedToday,
    };

    res.setHeader('Content-Type', 'text/event-stream');
    // Disable proxy buffering — Cloud Run's Google Frontend respects this
    // and won't hold the response back, otherwise our stream arrives as one
    // batched chunk at the end of the turn instead of incrementally. Also
    // forbid transformative caches (gzip, brotli) which buffer to compute
    // their headers.
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    // Disable Nagle's algorithm so res.write() flushes to the socket
    // immediately instead of coalescing small SSE chunks. Without this
    // every event is held up to ~40ms before transmission, which on top
    // of Google Frontend's buffering window makes the stream feel
    // batched even though we're correctly producing partials.
    res.socket?.setNoDelay(true);
    res.flushHeaders?.();
    // Cloud Run's Google Frontend buffers small responses (~4KB threshold)
    // before forwarding any bytes to the client. A leading SSE comment
    // padded to 4KB pushes us past that threshold immediately, so
    // subsequent events flow live instead of arriving as one batched
    // chunk at the end of the turn. Comments are ignored by EventSource
    // and our parser (lines that don't start with `data: `).
    res.write(`: ${' '.repeat(4096)}\n\n`);

    const runner = deps.runnerFor({ ctx: instructionCtx, uid: effectiveUserId, usagePolicy });

    // Track tool invocations for the structured turn log. We care about name
    // + args (for debugging), whether the response had an error status, AND
    // per-tool latency (call→response delta) so we can spot e.g. slow gws
    // subprocess calls in the chat.turn log.
    const toolInvocations: Array<{
      name: string;
      args: unknown;
      ok: boolean | null;
      latencyMs: number | null;
    }> = [];
    const pendingById = new Map<string, { name: string; args: unknown; startedAt: number }>();

    try {
      const tSession0 = Date.now();
      // Reuse the prefetched session when sessionReader is wired to the
      // same store (always true in production); only fall back to the
      // runner's session service when the prefetch was skipped. Keep the
      // reference so the empty-turn guard can persist a recovery event
      // via appendEvent (needs the live session object).
      let runnerSession =
        existingSession ??
        (await runner.sessionService.getSession({
          appName: runner.appName,
          userId: effectiveUserId,
          sessionId,
        }));
      if (!runnerSession) {
        runnerSession = await runner.sessionService.createSession({
          appName: runner.appName,
          userId: effectiveUserId,
          sessionId,
        });
      }
      timings.sessionMs = Date.now() - tSession0;

      const newMessage: Content = { role: 'user', parts: [{ text: message }] };
      // When a choice tool fires, stop the model's stream after its response
      // so the model can't emit text before or after the picker. The widget
      // is the entire turn. (Belt-and-braces with the prompt rule.)
      let choiceShown = false;
      // Tools that render an interactive UI element and should end the
      // agent's turn once fired — prevents the model from writing prose
      // before or after the widget AND closes the SSE promptly so the
      // browser can act on the widget without busy=true blocking the
      // synthetic follow-up message.
      const turnEndingToolNames = new Set([
        'ask_single_choice_question',
        'ask_multiple_choice_question',
        'auth_user',
        'connect_workspace',
        'upgrade_to_pro',
      ]);
      const tStream0 = Date.now();
      let firstEventMs: number | null = null;
      let firstTextMs: number | null = null;
      for await (const event of runner.runAsync({
        userId: effectiveUserId,
        sessionId,
        newMessage,
        // SSE streaming so partial events flow back to the browser as the
        // model produces them — drops first-text latency from "wait for
        // whole reply" to ~the first paragraph break.
        runConfig: { streamingMode: StreamingMode.SSE },
      })) {
        if (firstEventMs === null) firstEventMs = Date.now() - tStream0;
        if (
          firstTextMs === null &&
          (event as { content?: { parts?: Array<{ text?: string }> } }).content?.parts?.some(
            (p) => typeof p.text === 'string' && p.text.length > 0,
          )
        ) {
          firstTextMs = Date.now() - tStream0;
        }
        for (const call of getFunctionCalls(event)) {
          if (call.id) {
            pendingById.set(call.id, {
              name: call.name ?? '?',
              args: call.args,
              startedAt: Date.now(),
            });
          }
        }
        for (const resp of getFunctionResponses(event)) {
          const pending = resp.id ? pendingById.get(resp.id) : undefined;
          const name = pending?.name ?? resp.name ?? '?';
          const respObj = resp.response as { status?: string } | undefined;
          const ok = respObj?.status === undefined ? null : respObj.status !== 'error';
          const latencyMs = pending ? Date.now() - pending.startedAt : null;
          toolInvocations.push({ name, args: pending?.args ?? null, ok, latencyMs });
          if (resp.id) pendingById.delete(resp.id);
          if (
            turnEndingToolNames.has(name) &&
            (respObj?.status === 'shown' ||
              respObj?.status === 'auth_prompted' ||
              respObj?.status === 'oauth_prompted' ||
              respObj?.status === 'upgrade_prompted')
          ) {
            choiceShown = true;
          }
        }
        res.write(`data: ${JSON.stringify(event)}\n\n`);
        if (choiceShown) break;
      }
      timings.streamMs = Date.now() - tStream0;
      timings.ttfbMs = firstEventMs ?? -1;
      timings.ttftMs = firstTextMs ?? -1;

      // Empty-turn guard: Gemini occasionally returns tool calls and no
      // follow-up text. Without recovery the user sees silence, AND the
      // empty model turn lands in history and poisons subsequent turns.
      // Emit a synthetic text reply so (a) the user gets something
      // useful, (b) future turns see a text-bearing model event in
      // history.
      if (firstTextMs === null && toolInvocations.length > 0 && !choiceShown) {
        const recovery = pickRecoveryText(toolInvocations);
        // SSE side: send as a partial-style delta so the web parser
        // (parseSseAssistantText looks for `partial === true` text deltas)
        // appends it to the visible bubble.
        res.write(
          `data: ${JSON.stringify({
            author: 'lifecoach',
            partial: true,
            content: { role: 'model', parts: [{ text: recovery }] },
          })}\n\n`,
        );
        // Persistence side: full Event object so it lands in session
        // history exactly like a normal model reply.
        const synthEvent = makeRecoveryEvent(recovery, `recovery-${sessionId}-${Date.now()}`);
        if (runner.sessionService.appendEvent) {
          await runner.sessionService
            .appendEvent({ session: runnerSession, event: synthEvent })
            .catch(() => {
              /* persistence is best-effort; user already saw the text */
            });
        }
        // eslint-disable-next-line no-console
        console.log(
          JSON.stringify({
            msg: 'chat.empty_after_tool_recovery',
            uid: effectiveUserId,
            sessionId,
            tools: toolInvocations.map((t) => t.name),
          }),
        );
      }

      res.write('event: done\ndata: {}\n\n');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.write(`event: error\ndata: ${JSON.stringify({ message: msg })}\n\n`);
    } finally {
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify({
          msg: 'chat.turn',
          uid: effectiveUserId,
          sessionId,
          state: machine.current(),
          authenticated: claims !== null,
          hasLocation: coord !== null,
          hasWeather: weather !== null,
          airQualityAqi: airQuality?.aqi ?? null,
          holidayCount: holidays?.length ?? 0,
          todayEventCount: calendarDensity?.today.count ?? null,
          tomorrowEventCount: calendarDensity?.tomorrow.count ?? null,
          hasProfile: userProfile !== undefined,
          nearbyPlacesCount: nearbyPlaces?.length ?? 0,
          memoriesCount: memories?.length ?? 0,
          recentGoalCount: recentGoalUpdates?.length ?? 0,
          toolCount: toolInvocations.length,
          tools: toolInvocations,
          // Tier-policy fields — track post-deploy distribution so we can
          // tune thresholds without re-instrumenting.
          chatTurnCount,
          tier,
          usageState: usagePolicy.state,
          model: usagePolicy.model,
          nudgeMode: usagePolicy.nudgeMode,
          // Per-phase timings (ms). Populated as we go; missing keys mean
          // the phase short-circuited. totalMs is the wall-clock from /chat
          // entry to the finally block.
          totalMs: tick(),
          timings,
        }),
      );
      res.end();
    }
  });

  return app;
}

async function main(): Promise<void> {
  const [
    { Runner: RealRunner },
    { createRootAgent },
    { createWeatherClient },
    { createAirQualityClient },
    { createHolidaysClient },
    { createCalendarDensityClient },
    { createPlacesClient },
    { createMem0MemoryClient, noopMemoryClient },
    { createUserProfileStore },
    { createGoalUpdatesStore },
    { createWorkspaceTokensStore },
    { createUserMetaStore },
    { createWorkspaceOAuthClient, createRealWorkspaceOAuthClient },
    { createFirestoreSessionService },
    { createUpdateUserProfileTool },
    { createLogGoalUpdateTool },
    { createAskSingleChoiceTool, createAskMultipleChoiceTool },
    { createAuthUserTool },
    { createMemorySaveTool },
    { createConnectWorkspaceTool },
    { createCallWorkspaceTool },
    { createUpgradeToProTool },
    { Storage },
    { Firestore },
    admin,
  ] = await Promise.all([
    import('@google/adk'),
    import('./agent.js'),
    import('./context/weather.js'),
    import('./context/airQuality.js'),
    import('./context/holidays.js'),
    import('./context/calendarDensity.js'),
    import('./context/places.js'),
    import('./context/memory.js'),
    import('./storage/userProfile.js'),
    import('./storage/goalUpdates.js'),
    import('./storage/workspaceTokens.js'),
    import('./storage/userMeta.js'),
    import('./oauth/workspaceClient.js'),
    import('./storage/firestoreSession.js'),
    import('./tools/updateUserProfile.js'),
    import('./tools/logGoalUpdate.js'),
    import('./tools/askChoice.js'),
    import('./tools/authUser.js'),
    import('./tools/memorySave.js'),
    import('./tools/connectWorkspace.js'),
    import('./tools/callWorkspace.js'),
    import('./tools/upgradeToPro.js'),
    import('@google-cloud/storage'),
    import('@google-cloud/firestore'),
    import('firebase-admin/app'),
  ]);

  admin.initializeApp();
  const { getAuth: getAdminAuth } = await import('firebase-admin/auth');
  const verifyToken: TokenVerifier = async (token) => {
    const decoded = await getAdminAuth().verifyIdToken(token);
    return {
      uid: decoded.uid,
      email: decoded.email,
      email_verified: decoded.email_verified,
      firebase: {
        sign_in_provider: decoded.firebase?.sign_in_provider,
        identities: decoded.firebase?.identities as Record<string, string[] | undefined>,
      },
    };
  };

  const bucketName = process.env.USER_BUCKET;
  if (!bucketName) throw new Error('USER_BUCKET env var is required');
  const storage = new Storage();
  const bucket = storage.bucket(bucketName);
  const profileStore = createUserProfileStore({ bucket });
  const goalUpdatesStore = createGoalUpdatesStore({ bucket });

  // Firestore-backed persistent sessions — history survives Cloud Run cold
  // starts, scaling events, and page reloads. ADC-authenticated via the
  // agent's service account. `ignoreUndefinedProperties` because ADK Event
  // objects have optional fields (e.g. `branch`) that come through as
  // undefined; without this flag Firestore rejects the whole document.
  const firestore = new Firestore({ ignoreUndefinedProperties: true });
  const sessionService = createFirestoreSessionService({ firestore });
  const weather = createWeatherClient();
  const airQuality = createAirQualityClient();
  const holidays = createHolidaysClient();

  // Workspace OAuth + token store. Enabled only when client-id + secret are
  // plumbed through env (set by Terraform). If missing, the state never
  // flips to workspace_connected and the tool is never registered — the
  // rest of the app keeps working.
  const wsClientId = process.env.GWS_OAUTH_CLIENT_ID;
  const wsClientSecret = process.env.GWS_OAUTH_CLIENT_SECRET;
  const workspaceEnabled = Boolean(wsClientId && wsClientSecret);
  const workspaceOAuthClient = workspaceEnabled
    ? createWorkspaceOAuthClient({
        client: createRealWorkspaceOAuthClient({
          clientId: wsClientId as string,
          clientSecret: wsClientSecret as string,
        }),
      })
    : undefined;
  const workspaceTokensStore = workspaceOAuthClient
    ? createWorkspaceTokensStore({ firestore, oauthClient: workspaceOAuthClient })
    : undefined;
  // Calendar density: only meaningful when workspace tokens exist. Same store
  // path as call_workspace, so refreshes share the same per-uid mutex.
  const calendarDensity = workspaceTokensStore
    ? createCalendarDensityClient({ store: workspaceTokensStore })
    : undefined;
  // Per-uid usage meta: chat counter + tier. Drives UsageStateMachine
  // policy in /chat (model selection + signup/pro nudges + upgrade tool).
  const userMetaStore = createUserMetaStore({ firestore });
  if (!workspaceEnabled) {
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        msg: 'workspace.disabled',
        reason:
          'GWS_OAUTH_CLIENT_ID / GWS_OAUTH_CLIENT_SECRET not set — workspace tools inert this run',
      }),
    );
  }

  // Places uses an ADC-sourced OAuth2 token — no API key management.
  const { GoogleAuth } = await import('google-auth-library');
  const googleAuth = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  const places = createPlacesClient({
    tokenProvider: async () => {
      const client = await googleAuth.getClient();
      const headers = await client.getRequestHeaders();
      const auth = headers.Authorization ?? headers.authorization ?? '';
      const m = /^Bearer\s+(.+)$/i.exec(auth);
      if (!m?.[1]) throw new Error('could not extract Bearer token from ADC');
      return m[1];
    },
  });

  // Long-term memory via mem0. If MEM0_API_KEY isn't configured, the client
  // is a silent no-op — the rest of the app keeps working and no memory
  // features activate.
  const memoryEnabled = Boolean(process.env.MEM0_API_KEY);
  const memory = memoryEnabled
    ? createMem0MemoryClient({ apiKey: process.env.MEM0_API_KEY as string })
    : noopMemoryClient();
  if (!memoryEnabled) {
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        msg: 'memory.disabled',
        reason: 'MEM0_API_KEY not set — long-term memory tools are inert this run',
      }),
    );
  }
  const runnerFor = ({ ctx, uid, usagePolicy }: RunnerForParams): RunnerLike =>
    new RealRunner({
      appName: 'lifecoach',
      agent: createRootAgent(
        ctx,
        [
          createUpdateUserProfileTool({ store: profileStore, uid }),
          createLogGoalUpdateTool({ store: goalUpdatesStore, uid }),
          createAskSingleChoiceTool(),
          createAskMultipleChoiceTool(),
          // auth_user only matters when the user is anonymous. Gate by state
          // so a signed-in user's agent doesn't even see the tool.
          ...(ctx.userState === 'anonymous' ? [createAuthUserTool()] : []),
          ...(memoryEnabled ? [createMemorySaveTool({ client: memory, uid })] : []),
          // connect_workspace is a UI directive — available whenever the user
          // could next grant or re-grant (i.e. google-linked or already
          // connected, to allow reconnect).
          ...(workspaceEnabled &&
          (ctx.userState === 'google_linked' || ctx.userState === 'workspace_connected')
            ? [createConnectWorkspaceTool()]
            : []),
          // call_workspace binds auth server-side; only registered when
          // tokens exist (workspace_connected state).
          ...(workspaceEnabled && workspaceTokensStore && ctx.userState === 'workspace_connected'
            ? [
                createCallWorkspaceTool({
                  store: workspaceTokensStore,
                  uid,
                  log: (event) => {
                    // eslint-disable-next-line no-console
                    console.log(JSON.stringify({ msg: 'tool.call_workspace', ...event }));
                  },
                }),
              ]
            : []),
          // upgrade_to_pro is a UI directive available only when the
          // UsageStateMachine says so (free user past PRO_NUDGE_AFTER turns).
          ...(usagePolicy.upgradeToolAvailable ? [createUpgradeToProTool()] : []),
          // Practices: each enabled practice contributes its own tools
          // (e.g. log_gratitude, journal_entry). Disabled practices add
          // nothing here — the prompt-side "available practices" hint
          // tells the agent how to offer enabling them.
          ...getEnabledPractices(ctx.userProfile).flatMap((p) =>
            p.tools ? p.tools({ profileStore }, uid) : [],
          ),
        ],
        // Model is driven by tier — anonymous heavy users get Flash Lite.
        { model: usagePolicy.model },
      ),
      sessionService,
    }) as unknown as RunnerLike;

  const app = createApp({
    runnerFor,
    sessionReader: {
      appName: 'lifecoach',
      getSession: (p) => sessionService.getSession(p),
      listSessions: (p) => sessionService.listSessions(p),
    },
    verifyToken,
    requireAuth: process.env.REQUIRE_AUTH === 'true',
    weather,
    airQuality,
    holidays,
    calendarDensity,
    places,
    memory,
    profileStore,
    goalUpdatesStore,
    workspaceTokensStore,
    workspaceOAuthClient,
    userMetaStore,
  });

  const port = Number(process.env.PORT ?? 8080);
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`[lifecoach-agent] listening on :${port}`);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[lifecoach-agent] fatal', err);
    process.exit(1);
  });
}
