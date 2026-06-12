'use client';

import type { User } from 'firebase/auth';

/**
 * Browser-side helpers for Notion OAuth. Token handling lives server-
 * side: the browser opens Notion's authorize URL in a popup, the
 * callback page collects the code, and our /api/notion/oauth-exchange
 * forwards it to the agent — the agent exchanges it for tokens and
 * stores them in Firestore. The browser never sees access or refresh
 * tokens.
 *
 * Notion OAuth differs from Google's GIS:
 *  - No JS SDK. We construct the authorize URL directly.
 *  - Exact-match redirect URI required — we host one callback page
 *    at /notion/callback that postMessages the code back to the
 *    opener window.
 *  - For per-PR preview deploys, the registered redirect URI on the
 *    Notion integration is the apex `tranquil.coach/notion/callback`;
 *    that page is a forwarder that reads the originating origin out
 *    of the OAuth `state` param and re-postMessages back to the
 *    PR-preview origin (lands in a follow-up).
 */

export interface NotionStatus {
  connected: boolean;
  workspaceName: string | null;
  grantedAt: string | null;
}

const NOTION_AUTHORIZE_URL = 'https://api.notion.com/v1/oauth/authorize';

function requireClientId(): string {
  const id = process.env.NEXT_PUBLIC_NOTION_OAUTH_CLIENT_ID;
  if (!id) {
    throw new Error(
      'NEXT_PUBLIC_NOTION_OAUTH_CLIENT_ID is not set — cannot open the Notion consent popup',
    );
  }
  return id;
}

interface NotionOAuthMessage {
  type: 'notion-oauth-done';
  code: string;
  state: string;
}

function isNotionOAuthMessage(value: unknown): value is NotionOAuthMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>).type === 'notion-oauth-done' &&
    typeof (value as Record<string, unknown>).code === 'string' &&
    typeof (value as Record<string, unknown>).state === 'string'
  );
}

/**
 * Opens Notion's authorize URL in a popup window and waits for the
 * callback page to postMessage back the auth code. Then POSTs the
 * code + redirect_uri to /api/notion/oauth-exchange, which the agent
 * uses to redeem tokens. Resolves with the updated status.
 */
export async function connectNotion(user: User): Promise<NotionStatus> {
  if (typeof window === 'undefined') {
    throw new Error('connectNotion: must be called in the browser');
  }
  const clientId = requireClientId();
  const redirectUri = `${window.location.origin}/notion/callback`;
  // CSRF state — Notion echoes it back so the callback page can
  // verify it matches what we generated. Crypto.randomUUID is fine
  // here (no need for cryptographic seriousness — replay would need
  // both the code and the matching state).
  const csrfState = crypto.randomUUID();

  const authorizeUrl = new URL(NOTION_AUTHORIZE_URL);
  authorizeUrl.searchParams.set('owner', 'user');
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('state', csrfState);

  const popup = window.open(
    authorizeUrl.toString(),
    'notion-oauth',
    'width=620,height=720,left=200,top=200',
  );
  if (popup === null) {
    throw new Error('oauth_popup_blocked');
  }

  const code = await new Promise<string>((resolve, reject) => {
    const handler = (event: MessageEvent) => {
      // Same-origin only; the callback page lives on our domain.
      if (event.origin !== window.location.origin) return;
      if (!isNotionOAuthMessage(event.data)) return;
      if (event.data.state !== csrfState) {
        cleanup();
        reject(new Error('oauth_state_mismatch'));
        return;
      }
      cleanup();
      resolve(event.data.code);
    };
    const closedPoll = setInterval(() => {
      if (popup.closed) {
        cleanup();
        reject(new Error('oauth_popup_closed'));
      }
    }, 500);
    function cleanup() {
      clearInterval(closedPoll);
      window.removeEventListener('message', handler);
      try {
        popup?.close();
      } catch {
        /* ignored */
      }
    }
    window.addEventListener('message', handler);
  });

  const idToken = await user.getIdToken();
  const res = await fetch('/api/notion/oauth-exchange', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ code, redirect_uri: redirectUri }),
  });
  if (!res.ok) {
    throw new Error(`notion_oauth_exchange_failed: ${res.status}`);
  }
  const body = (await res.json().catch(() => ({}))) as Partial<NotionStatus>;
  return {
    connected: Boolean(body.connected),
    workspaceName: body.workspaceName ?? null,
    grantedAt: body.grantedAt ?? null,
  };
}

export async function fetchNotionStatus(user: User): Promise<NotionStatus> {
  const idToken = await user.getIdToken();
  const res = await fetch('/api/notion/status', {
    headers: { authorization: `Bearer ${idToken}` },
  });
  if (!res.ok) {
    if (res.status === 401) return { connected: false, workspaceName: null, grantedAt: null };
    throw new Error(`notion_status_failed: ${res.status}`);
  }
  const body = (await res.json().catch(() => ({}))) as Partial<NotionStatus>;
  return {
    connected: Boolean(body.connected),
    workspaceName: body.workspaceName ?? null,
    grantedAt: body.grantedAt ?? null,
  };
}

export async function revokeNotion(user: User): Promise<NotionStatus> {
  const idToken = await user.getIdToken();
  const res = await fetch('/api/notion', {
    method: 'DELETE',
    headers: { authorization: `Bearer ${idToken}` },
  });
  if (!res.ok) throw new Error(`notion_revoke_failed: ${res.status}`);
  const body = (await res.json().catch(() => ({}))) as Partial<NotionStatus>;
  return {
    connected: Boolean(body.connected),
    workspaceName: body.workspaceName ?? null,
    grantedAt: body.grantedAt ?? null,
  };
}
