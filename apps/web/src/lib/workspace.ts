'use client';

import {
  WORKSPACE_SCOPES,
  type WorkspaceStatus,
  WorkspaceStatusSchema,
} from '@lifecoach/shared-types';
import type { User } from 'firebase/auth';

/**
 * Browser-side helpers for Google Workspace OAuth. All token handling lives
 * server-side: the browser gets an authorisation *code* via the GIS popup
 * and POSTs it to the agent, which exchanges it for tokens and stores them
 * in Firestore. The browser never sees access or refresh tokens.
 */

export { WORKSPACE_SCOPES } from '@lifecoach/shared-types';

/** GIS library script URL — officially hosted by Google. */
const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client';

interface GoogleOAuth2TokenResponse {
  code?: string;
  error?: string;
  error_description?: string;
}

interface GoogleOAuth2CodeClient {
  requestCode(): void;
}

interface GoogleOAuth2 {
  initCodeClient(config: {
    client_id: string;
    scope: string;
    ux_mode: 'popup' | 'redirect';
    redirect_uri?: string;
    callback: (resp: GoogleOAuth2TokenResponse) => void;
    error_callback?: (err: unknown) => void;
  }): GoogleOAuth2CodeClient;
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: GoogleOAuth2;
      };
    };
  }
}

let gisLoader: Promise<void> | null = null;

export function loadGisScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gisLoader) return gisLoader;
  gisLoader = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${GIS_SCRIPT_URL}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('gis-script-failed')), {
        once: true,
      });
      return;
    }
    const s = document.createElement('script');
    s.src = GIS_SCRIPT_URL;
    s.async = true;
    s.defer = true;
    s.addEventListener('load', () => resolve(), { once: true });
    s.addEventListener('error', () => reject(new Error('gis-script-failed')), { once: true });
    document.head.appendChild(s);
  });
  return gisLoader;
}

function requireClientId(): string {
  const id = process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID;
  if (!id) {
    throw new Error(
      'NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID is not set — cannot open the workspace consent popup',
    );
  }
  return id;
}

/**
 * Opens the Google Identity Services popup to consent for Gmail/Calendar/
 * Tasks. On success, POSTs the auth code to our own /api/workspace/oauth-
 * exchange endpoint which calls the agent. Resolves with the updated
 * status. Never returns the code to the caller — passed straight through.
 */
export async function connectWorkspace(user: User): Promise<WorkspaceStatus> {
  await loadGisScript();
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) throw new Error('GIS oauth2 module not available after script load');
  const clientId = requireClientId();

  const code = await new Promise<string>((resolve, reject) => {
    const client = oauth2.initCodeClient({
      client_id: clientId,
      scope: WORKSPACE_SCOPES.join(' '),
      ux_mode: 'popup',
      redirect_uri: 'postmessage',
      callback: (resp) => {
        if (resp.code) resolve(resp.code);
        else reject(new Error(resp.error || 'oauth_popup_no_code'));
      },
      error_callback: (err) => reject(new Error(`oauth_popup_error: ${String(err)}`)),
    });
    client.requestCode();
  });

  const idToken = await user.getIdToken();
  const res = await fetch('/api/workspace/oauth-exchange', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) {
    throw new Error(`oauth_exchange_failed: ${res.status}`);
  }
  const body = await res.json().catch(() => ({}));
  return WorkspaceStatusSchema.parse({
    connected: Boolean((body as { connected?: boolean }).connected),
    scopes: Array.isArray((body as { scopes?: unknown }).scopes)
      ? (body as { scopes: string[] }).scopes
      : [],
    grantedAt: (body as { grantedAt?: string | null }).grantedAt ?? null,
  });
}

export async function fetchWorkspaceStatus(user: User): Promise<WorkspaceStatus> {
  const idToken = await user.getIdToken();
  const res = await fetch('/api/workspace/status', {
    headers: { authorization: `Bearer ${idToken}` },
  });
  if (!res.ok) {
    if (res.status === 401) return { connected: false, scopes: [], grantedAt: null };
    throw new Error(`status_failed: ${res.status}`);
  }
  const body = await res.json().catch(() => ({}));
  return WorkspaceStatusSchema.parse({
    connected: Boolean((body as { connected?: boolean }).connected),
    scopes: Array.isArray((body as { scopes?: unknown }).scopes)
      ? (body as { scopes: string[] }).scopes
      : [],
    grantedAt: (body as { grantedAt?: string | null }).grantedAt ?? null,
  });
}

export async function revokeWorkspace(user: User): Promise<WorkspaceStatus> {
  const idToken = await user.getIdToken();
  const res = await fetch('/api/workspace', {
    method: 'DELETE',
    headers: { authorization: `Bearer ${idToken}` },
  });
  if (!res.ok) throw new Error(`revoke_failed: ${res.status}`);
  const body = await res.json().catch(() => ({}));
  return WorkspaceStatusSchema.parse({
    connected: Boolean((body as { connected?: boolean }).connected),
    scopes: Array.isArray((body as { scopes?: unknown }).scopes)
      ? (body as { scopes: string[] }).scopes
      : [],
    grantedAt: (body as { grantedAt?: string | null }).grantedAt ?? null,
  });
}
