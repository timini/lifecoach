'use client';

import { useEffect, useState } from 'react';

/**
 * Notion OAuth callback page.
 *
 * Notion redirects here after the user grants (or denies) consent with
 * `?code=...&state=...` (or `?error=...`). We pull the params, post a
 * message back to `window.opener` (the parent tab that called
 * `connectNotion`), and close.
 *
 * The exchange itself is initiated by the opener (it calls our
 * /api/notion/oauth-exchange route) — this page only carries the code
 * across the popup boundary.
 */
export default function NotionCallbackPage() {
  const [message, setMessage] = useState<string>('Finishing connection…');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    if (error) {
      setMessage(`Notion connect failed: ${error}`);
      try {
        window.opener?.postMessage({ type: 'notion-oauth-error', error }, window.location.origin);
      } catch {
        /* ignored — opener closed */
      }
      // Leave the popup open briefly so the user sees the error before
      // closing it themselves; some browsers swallow postMessage when
      // the popup closes too quickly.
      const t = setTimeout(() => window.close(), 1500);
      return () => clearTimeout(t);
    }

    if (code && state) {
      try {
        window.opener?.postMessage(
          { type: 'notion-oauth-done', code, state },
          window.location.origin,
        );
      } catch {
        /* ignored */
      }
      window.close();
      // If close() is suppressed (Firefox sometimes), surface a hint.
      setMessage('Done — you can close this tab.');
      return;
    }

    setMessage('Notion callback was missing required parameters.');
  }, []);

  return (
    <main style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
      <p>{message}</p>
    </main>
  );
}
