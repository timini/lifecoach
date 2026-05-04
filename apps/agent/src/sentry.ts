import * as Sentry from '@sentry/node';

const DSN = process.env.SENTRY_DSN;
let initialized = false;

/**
 * Initialise Sentry on the agent. No-op if `SENTRY_DSN` is unset (local
 * dev, preview deploys without telemetry). Idempotent — safe to call on
 * every cold start.
 */
export function initSentry(): void {
  if (initialized || !DSN) return;
  initialized = true;
  Sentry.init({
    dsn: DSN,
    environment: process.env.SENTRY_ENVIRONMENT ?? 'unknown',
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: 0.05,
    sendDefaultPii: false,
  });
}

/**
 * Record a non-error chat-pipeline event with structured context. Safe to
 * call before `initSentry` — no-ops without a DSN.
 */
export function captureChatEvent(
  message: string,
  context: Record<string, unknown>,
  level: Sentry.SeverityLevel = 'warning',
): void {
  if (!DSN) return;
  Sentry.captureMessage(message, {
    level,
    tags: { feature: 'chat' },
    extra: context,
  });
}
