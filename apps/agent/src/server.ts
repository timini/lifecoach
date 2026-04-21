import type { Event, Session } from '@google/adk';
import type { Content } from '@google/genai';
import express, { type Express, type Request, type Response } from 'express';

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

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const { runner } = deps;
    try {
      const existing = await runner.sessionService.getSession({
        appName: runner.appName,
        userId,
        sessionId,
      });
      if (!existing) {
        await runner.sessionService.createSession({
          appName: runner.appName,
          userId,
          sessionId,
        });
      }

      const newMessage: Content = { role: 'user', parts: [{ text: message }] };
      for await (const event of runner.runAsync({ userId, sessionId, newMessage })) {
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
 * Intentionally kept in a `main()` so tests can import createApp without
 * booting the server.
 */
async function main(): Promise<void> {
  const [{ InMemorySessionService, Runner: RealRunner }, { createRootAgent }] = await Promise.all([
    import('@google/adk'),
    import('./agent.js'),
  ]);

  const sessionService = new InMemorySessionService();
  const runner = new RealRunner({
    appName: 'lifecoach',
    agent: createRootAgent(),
    sessionService,
  }) as unknown as RunnerLike;

  const app = createApp({ runner });
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
