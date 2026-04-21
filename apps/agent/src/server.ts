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
import type { PlacesClient } from './context/places.js';
import type { Coord, WeatherClient } from './context/weather.js';
import type { InstructionContext, LocationCtx } from './prompt/buildInstruction.js';
import type { GoalUpdatesStore } from './storage/goalUpdates.js';
import type { UserProfileStore } from './storage/userProfile.js';

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

export interface CreateAppDeps {
  /**
   * Factory invoked per request with the turn's InstructionContext + uid.
   * The server builds the context, the factory builds a Runner with a
   * fresh LlmAgent wired to the shared session service and a uid-scoped
   * update_user_profile tool.
   */
  runnerFor: (params: RunnerForParams) => RunnerLike;
  verifyToken?: TokenVerifier;
  requireAuth?: boolean;
  weather?: WeatherClient;
  places?: PlacesClient;
  profileStore?: UserProfileStore;
  goalUpdatesStore?: GoalUpdatesStore;
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

    const machine = claims
      ? UserStateMachine.fromFirebaseUser(claimsToFirebaseUserLike(claims, false))
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

    const instructionCtx: InstructionContext = {
      now: now(),
      timezone: timezone ?? null,
      userState: machine.current(),
      location: locationCtx,
      weather,
      userProfile,
      recentGoalUpdates,
      nearbyPlaces,
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
          const respObj = resp.response as { status?: string } | undefined;
          // Any non-"error" status counts as ok (tools use 'ok', 'shown', etc.).
          const ok = respObj?.status === undefined ? null : respObj.status !== 'error';
          toolInvocations.push({
            name: pending?.name ?? resp.name ?? '?',
            args: pending?.args ?? null,
            ok,
          });
          if (resp.id) pendingById.delete(resp.id);
        }
        res.write(`data: ${JSON.stringify(event)}\n\n`);
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
    { InMemorySessionService, Runner: RealRunner },
    { createRootAgent },
    { createWeatherClient },
    { createPlacesClient },
    { createUserProfileStore },
    { createGoalUpdatesStore },
    { createUpdateUserProfileTool },
    { createLogGoalUpdateTool },
    { createAskSingleChoiceTool, createAskMultipleChoiceTool },
    { Storage },
    admin,
  ] = await Promise.all([
    import('@google/adk'),
    import('./agent.js'),
    import('./context/weather.js'),
    import('./context/places.js'),
    import('./storage/userProfile.js'),
    import('./storage/goalUpdates.js'),
    import('./tools/updateUserProfile.js'),
    import('./tools/logGoalUpdate.js'),
    import('./tools/askChoice.js'),
    import('@google-cloud/storage'),
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

  const sessionService = new InMemorySessionService();
  const weather = createWeatherClient();

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
  const runnerFor = ({ ctx, uid }: RunnerForParams): RunnerLike =>
    new RealRunner({
      appName: 'lifecoach',
      agent: createRootAgent(ctx, [
        createUpdateUserProfileTool({ store: profileStore, uid }),
        createLogGoalUpdateTool({ store: goalUpdatesStore, uid }),
        createAskSingleChoiceTool(),
        createAskMultipleChoiceTool(),
      ]),
      sessionService,
    }) as unknown as RunnerLike;

  const app = createApp({
    runnerFor,
    verifyToken,
    requireAuth: process.env.REQUIRE_AUTH === 'true',
    weather,
    places,
    profileStore,
    goalUpdatesStore,
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
