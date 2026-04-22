import { type Event, type Session, getFunctionCalls, getFunctionResponses } from '@google/adk';
import type { Content } from '@google/genai';
import { UserStateMachine } from '@lifecoach/user-state';
import express, { type Express, type Request, type Response } from 'express';
import {
  type TokenVerifier,
  type VerifiedClaims,
  claimsToFirebaseUserLike,
  verifyRequest,
} from './auth.js';
import type { MemoryClient } from './context/memory.js';
import type { PlacesClient } from './context/places.js';
import type { Coord, WeatherClient } from './context/weather.js';
import type { WorkspaceOAuthClient } from './oauth/workspaceClient.js';
import type { InstructionContext, LocationCtx } from './prompt/buildInstruction.js';
import type { GoalUpdatesStore } from './storage/goalUpdates.js';
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
  };
  runAsync(params: {
    userId: string;
    sessionId: string;
    newMessage: Content;
  }): AsyncGenerator<Event, void, undefined>;
}

export interface RunnerForParams {
  ctx: InstructionContext;
  uid: string;
}

export interface SessionReader {
  appName: string;
  getSession(params: {
    appName: string;
    userId: string;
    sessionId: string;
  }): Promise<Session | null | undefined>;
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
  memory?: MemoryClient;
  profileStore?: UserProfileStore;
  goalUpdatesStore?: GoalUpdatesStore;
  workspaceTokensStore?: WorkspaceTokensStore;
  workspaceOAuthClient?: WorkspaceOAuthClient;
  now?: () => Date;
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

    // Compute workspaceScopesGranted from the Firestore doc — no LLM
    // involvement, no token in context. Presence of a non-empty refresh
    // token is enough; the tool handler does the expiry-and-refresh check
    // lazily when actually called.
    let workspaceScopesGranted = false;
    if (claims && deps.workspaceTokensStore) {
      try {
        const doc = await deps.workspaceTokensStore.get(effectiveUserId);
        workspaceScopesGranted = Boolean(doc?.refreshToken);
      } catch {
        workspaceScopesGranted = false;
      }
    }

    const machine = claims
      ? UserStateMachine.fromFirebaseUser(claimsToFirebaseUserLike(claims, workspaceScopesGranted))
      : new UserStateMachine('anonymous');

    // Fetch weather if location provided — cached for 30 min per region so
    // it's cheap across many turns.
    const coord: Coord | null = location ? { lat: location.lat, lng: location.lng } : null;
    const [weather, nearbyPlaces] = await Promise.all([
      coord && deps.weather ? deps.weather.get(coord) : Promise.resolve(null),
      coord && deps.places ? deps.places.get(coord) : Promise.resolve(undefined),
    ]);
    const locationCtx: LocationCtx | null = coord ? { coord } : null;

    // Read the user's profile so the agent sees the full user.yaml (including
    // nulls) as part of its system prompt every turn. Writes happen via the
    // update_user_profile tool that runnerFor will register with the uid.
    const userProfile = deps.profileStore
      ? await deps.profileStore.read(effectiveUserId).catch(() => undefined)
      : undefined;

    const recentGoalUpdates = deps.goalUpdatesStore
      ? await deps.goalUpdatesStore.recent(effectiveUserId, 20).catch(() => undefined)
      : undefined;

    // Silent memory retrieval — searched with the user's current message as
    // the query. Any error yields an empty list; never fails a turn.
    const memories = deps.memory
      ? await deps.memory.search(effectiveUserId, message, 5).catch(() => [])
      : [];

    const instructionCtx: InstructionContext = {
      now: now(),
      timezone: timezone ?? null,
      userState: machine.current(),
      location: locationCtx,
      weather,
      userProfile,
      recentGoalUpdates,
      nearbyPlaces,
      memories,
    };

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const runner = deps.runnerFor({ ctx: instructionCtx, uid: effectiveUserId });

    // Track tool invocations for the structured turn log. We care about name
    // + args (for debugging) and whether the response had an error status.
    const toolInvocations: Array<{
      name: string;
      args: unknown;
      ok: boolean | null;
    }> = [];
    const pendingById = new Map<string, { name: string; args: unknown }>();

    try {
      const existing = await runner.sessionService.getSession({
        appName: runner.appName,
        userId: effectiveUserId,
        sessionId,
      });
      if (!existing) {
        await runner.sessionService.createSession({
          appName: runner.appName,
          userId: effectiveUserId,
          sessionId,
        });
      }

      const newMessage: Content = { role: 'user', parts: [{ text: message }] };
      // When a choice tool fires, stop the model's stream after its response
      // so the model can't emit text before or after the picker. The widget
      // is the entire turn. (Belt-and-braces with the prompt rule.)
      let choiceShown = false;
      // Tools that render an interactive UI element and should end the
      // agent's turn once fired — prevents the model from writing prose
      // before or after the widget.
      const turnEndingToolNames = new Set([
        'ask_single_choice_question',
        'ask_multiple_choice_question',
        'auth_user',
      ]);
      for await (const event of runner.runAsync({
        userId: effectiveUserId,
        sessionId,
        newMessage,
      })) {
        for (const call of getFunctionCalls(event)) {
          if (call.id) pendingById.set(call.id, { name: call.name ?? '?', args: call.args });
        }
        for (const resp of getFunctionResponses(event)) {
          const pending = resp.id ? pendingById.get(resp.id) : undefined;
          const name = pending?.name ?? resp.name ?? '?';
          const respObj = resp.response as { status?: string } | undefined;
          const ok = respObj?.status === undefined ? null : respObj.status !== 'error';
          toolInvocations.push({ name, args: pending?.args ?? null, ok });
          if (resp.id) pendingById.delete(resp.id);
          if (
            turnEndingToolNames.has(name) &&
            (respObj?.status === 'shown' || respObj?.status === 'auth_prompted')
          ) {
            choiceShown = true;
          }
        }
        res.write(`data: ${JSON.stringify(event)}\n\n`);
        if (choiceShown) break;
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
          hasProfile: userProfile !== undefined,
          nearbyPlacesCount: nearbyPlaces?.length ?? 0,
          memoriesCount: memories?.length ?? 0,
          recentGoalCount: recentGoalUpdates?.length ?? 0,
          toolCount: toolInvocations.length,
          tools: toolInvocations,
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
    { createPlacesClient },
    { createMem0MemoryClient, noopMemoryClient },
    { createUserProfileStore },
    { createGoalUpdatesStore },
    { createWorkspaceTokensStore },
    { createWorkspaceOAuthClient, createRealWorkspaceOAuthClient },
    { createFirestoreSessionService },
    { createUpdateUserProfileTool },
    { createLogGoalUpdateTool },
    { createAskSingleChoiceTool, createAskMultipleChoiceTool },
    { createAuthUserTool },
    { createMemorySaveTool },
    { createConnectWorkspaceTool },
    { createCallWorkspaceTool },
    { Storage },
    { Firestore },
    admin,
  ] = await Promise.all([
    import('@google/adk'),
    import('./agent.js'),
    import('./context/weather.js'),
    import('./context/places.js'),
    import('./context/memory.js'),
    import('./storage/userProfile.js'),
    import('./storage/goalUpdates.js'),
    import('./storage/workspaceTokens.js'),
    import('./oauth/workspaceClient.js'),
    import('./storage/firestoreSession.js'),
    import('./tools/updateUserProfile.js'),
    import('./tools/logGoalUpdate.js'),
    import('./tools/askChoice.js'),
    import('./tools/authUser.js'),
    import('./tools/memorySave.js'),
    import('./tools/connectWorkspace.js'),
    import('./tools/callWorkspace.js'),
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
  const runnerFor = ({ ctx, uid }: RunnerForParams): RunnerLike =>
    new RealRunner({
      appName: 'lifecoach',
      agent: createRootAgent(ctx, [
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
      ]),
      sessionService,
    }) as unknown as RunnerLike;

  const app = createApp({
    runnerFor,
    sessionReader: {
      appName: 'lifecoach',
      getSession: (p) => sessionService.getSession(p),
    },
    verifyToken,
    requireAuth: process.env.REQUIRE_AUTH === 'true',
    weather,
    places,
    memory,
    profileStore,
    goalUpdatesStore,
    workspaceTokensStore,
    workspaceOAuthClient,
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
