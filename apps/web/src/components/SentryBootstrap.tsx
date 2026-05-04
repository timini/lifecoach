'use client';

import { useEffect } from 'react';
import { initSentry } from '../lib/sentry';

/**
 * Mounts once near the top of the tree and initialises Sentry on the
 * client. No-op if `NEXT_PUBLIC_SENTRY_DSN` is unset.
 */
export function SentryBootstrap(): null {
  useEffect(() => {
    initSentry();
  }, []);
  return null;
}
