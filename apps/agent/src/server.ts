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
  runner: RunnerLike;
  /**
   * Verifies Firebase ID tokens. If omitted, requests are accepted without
   * auth (dev/test convenience only — production must pass a real verifier).
   */
  verifyToken?: TokenVerifier;
  /**
   * If true, /chat rejects requests with no valid token. Defaults to false
   * so tests don't have to supply a verifier.
   */
  requireAuth?: boolean;
}

interface ChatBody {
  userId?: string;
  sessionId?: string;
  message?: string;
}

export function createApp(deps: CreateAppDeps): Express {
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok' });
  });

  app.post('/chat', async (req: Request<unknown, unknown, ChatBody>, res: Response) => {
    const { userId, sessionId, message } = req.body ?? {};
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
    // Agent trusts the UID from the verified token — if present — over the
    // one in the body. This prevents a client from claiming to be a different
    // user than its auth context.
    const effectiveUserId = claims?.uid ?? userId;

    // Surface the current user state so logs make it easy to see what tools
    // and directives would apply. Actual tool-gating lands in later phases.
    const machine = claims
      ? UserStateMachine.fromFirebaseUser(claimsToFirebaseUserLike(claims, false))
      : new UserStateMachine('anonymous');
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        msg: 'chat.turn',
        uid: effectiveUserId,
        sessionId,
        state: machine.current(),
        authenticated: claims !== null,
      }),
    );

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const { runner } = deps;
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

/**
 * Wires the real ADK Runner with the Lifecoach agent and starts listening.
 */
async function main(): Promise<void> {
  const [{ InMemorySessionService, Runner: RealRunner }, { createRootAgent }, admin] =
    await Promise.all([import('@google/adk'), import('./agent.js'), import('firebase-admin/app')]);

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

  const sessionService = new InMemorySessionService();
  const runner = new RealRunner({
    appName: 'lifecoach',
    agent: createRootAgent(),
    sessionService,
  }) as unknown as RunnerLike;

  const app = createApp({ runner, verifyToken, requireAuth: process.env.REQUIRE_AUTH === 'true' });
  const port = Number(process.env.PORT ?? 8080);
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`[lifecoach-agent] listening on :${port}`);
  });
}

// Only run main() when executed directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[lifecoach-agent] fatal', err);
    process.exit(1);
  });
}
