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
 * Record a non-error event with structured context. Always console.info so
 * devtools shows the timeline live (faster feedback than waiting for Sentry
 * to ingest); also forwards to Sentry when DSN is configured.
 */
export function captureChatEvent(message: string, context: Record<string, unknown>): void {
  if (typeof console !== 'undefined') {
    console.info(`[lifecoach] ${message}`, context);
  }
  if (!DSN) return;
  Sentry.captureMessage(message, {
    level: 'warning',
    tags: { feature: 'chat' },
    extra: context,
  });
}
