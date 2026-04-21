import type { Event, Session } from '@google/adk';
import type { Content } from '@google/genai';
import { UserStateMachine } from '@lifecoach/user-state';
import express, { type Express, type Request, type Response } from 'express';
import {
  type TokenVerifier,
  type VerifiedClaims,
  claimsToFirebaseUserLike,
  verifyRequest,
} from './auth.js';
import type { Coord, WeatherClient } from './context/weather.js';
import type { InstructionContext, LocationCtx } from './prompt/buildInstruction.js';

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

export interface CreateAppDeps {
  /**
   * Factory invoked per request with the turn's InstructionContext. The
   * server builds the context, the factory builds a Runner (typically with
   * a fresh LlmAgent wired to a shared session service).
   */
  runnerFor: (ctx: InstructionContext) => RunnerLike;
  verifyToken?: TokenVerifier;
  requireAuth?: boolean;
  /** Weather provider — optional so tests can skip it. */
  weather?: WeatherClient;
  /** Overridable clock for deterministic tests. */
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
    const weather = coord && deps.weather ? await deps.weather.get(coord) : null;
    const locationCtx: LocationCtx | null = coord ? { coord } : null;

    const instructionCtx: InstructionContext = {
      now: now(),
      timezone: timezone ?? null,
      userState: machine.current(),
      location: locationCtx,
      weather,
    };

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
      }),
    );

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const runner = deps.runnerFor(instructionCtx);

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
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
      res.write('event: done\ndata: {}\n\n');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.write(`event: error\ndata: ${JSON.stringify({ message: msg })}\n\n`);
    } finally {
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
    admin,
  ] = await Promise.all([
    import('@google/adk'),
    import('./agent.js'),
    import('./context/weather.js'),
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

  // Session storage is shared across turns; the LlmAgent is rebuilt each
  // turn with the turn's dynamic instruction.
  const sessionService = new InMemorySessionService();
  const weather = createWeatherClient();
  const runnerFor = (ctx: InstructionContext): RunnerLike =>
    new RealRunner({
      appName: 'lifecoach',
      agent: createRootAgent(ctx),
      sessionService,
    }) as unknown as RunnerLike;

  const app = createApp({
    runnerFor,
    verifyToken,
    requireAuth: process.env.REQUIRE_AUTH === 'true',
    weather,
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
