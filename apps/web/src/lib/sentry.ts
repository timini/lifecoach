'use client';

import * as Sentry from '@sentry/nextjs';

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;
let initialized = false;

/**
 * Initialise Sentry on the browser. No-op if `NEXT_PUBLIC_SENTRY_DSN` is
 * unset (preview deploys without telemetry, local dev). Idempotent.
 */
export function initSentry(): void {
  if (initialized || !DSN) return;
  initialized = true;
  Sentry.init({
    dsn: DSN,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? 'unknown',
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
  });
}

/**
 * Record a non-error event with structured context. Safe to call before
 * `initSentry` (it's a no-op without a DSN).
 */
export function captureChatEvent(message: string, context: Record<string, unknown>): void {
  if (!DSN) return;
  Sentry.captureMessage(message, {
    level: 'warning',
    tags: { feature: 'chat' },
    extra: context,
  });
}
