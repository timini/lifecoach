import type { WorkspaceOAuthClient, WorkspaceTokens } from '../oauth/workspaceClient.js';
import type { FirestoreLike } from './firestoreSession.js';

/**
 * Firestore-backed store for user-delegated Google Workspace OAuth tokens.
 *
 * Storage layout — one doc per user:
 *   workspaceTokens/{uid}
 *     { uid, accessToken, accessTokenExpiresAt, refreshToken, scopes,
 *       grantedAt, updatedAt }
 *
 * Strict auth-plane boundary: values here are touched only by the
 * application (this module and the tool *handlers*). The LLM never sees
 * them — the `call_workspace` tool's Zod schema has no token field, and
 * the tool-invocation log line emitted by the agent server never includes
 * them.
 */

export class ScopeRequiredError extends Error {
  readonly code = 'scope_required';
  constructor(message = 'Workspace access expired. Ask the user to reconnect in Settings.') {
    super(message);
    this.name = 'ScopeRequiredError';
  }
}

export interface StoredWorkspaceToken {
  uid: string;
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  scopes: string[];
  grantedAt: string;
  updatedAt: string;
}

export interface WorkspaceTokensStore {
  /** Full doc — internal server use only. */
  get(uid: string): Promise<StoredWorkspaceToken | null>;
  /** Upsert after a fresh OAuth exchange. */
  set(uid: string, tokens: WorkspaceTokens): Promise<StoredWorkspaceToken>;
  /** Remove the doc (best-effort revoke is handled separately). */
  delete(uid: string): Promise<void>;
  /**
   * Called from the tool handler. Returns a currently-valid access token;
   * refreshes via the OAuth client if within 60s of expiry. On refresh
   * failure, deletes the doc and throws ScopeRequiredError so the tool can
   * map to `{status:'error', code:'scope_required'}`.
   *
   * Per-uid in-memory mutex prevents dogpiling Google with parallel refresh
   * calls when two chat turns arrive simultaneously.
   */
  getValidAccessToken(uid: string): Promise<string>;
}

function docPath(uid: string): string {
  return `workspaceTokens/${uid}`;
}

export interface CreateWorkspaceTokensStoreDeps {
  firestore: FirestoreLike;
  oauthClient: WorkspaceOAuthClient;
  /** Injected for tests; defaults to Date.now(). */
  now?: () => number;
  /** Expiry skew — refresh when we're within this many ms of the stored expiry. */
  skewMs?: number;
}

export function createWorkspaceTokensStore(
  deps: CreateWorkspaceTokensStoreDeps,
): WorkspaceTokensStore {
  const { firestore, oauthClient } = deps;
  const now = deps.now ?? Date.now;
  const skewMs = deps.skewMs ?? 60_000;

  // Per-uid refresh mutex. Holds the in-flight refresh promise so parallel
  // callers await the same one instead of each hitting Google.
  const refreshLocks = new Map<string, Promise<string>>();

  async function get(uid: string): Promise<StoredWorkspaceToken | null> {
    const snap = await firestore.doc(docPath(uid)).get();
    if (!snap.exists) return null;
    const data = snap.data() as StoredWorkspaceToken | undefined;
    if (!data) return null;
    return data;
  }

  async function set(uid: string, tokens: WorkspaceTokens): Promise<StoredWorkspaceToken> {
    const existing = await get(uid);
    const nowIso = new Date(now()).toISOString();
    const stored: StoredWorkspaceToken = {
      uid,
      accessToken: tokens.accessToken,
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
      refreshToken: tokens.refreshToken,
      scopes: tokens.scopes,
      grantedAt: existing?.grantedAt ?? nowIso,
      updatedAt: nowIso,
    };
    await firestore.doc(docPath(uid)).set(stored);
    return stored;
  }

  async function del(uid: string): Promise<void> {
    await firestore.doc(docPath(uid)).delete();
  }

  async function doRefresh(uid: string, doc: StoredWorkspaceToken): Promise<string> {
    try {
      const refreshed = await oauthClient.refreshAccessToken(doc.refreshToken);
      const updated: StoredWorkspaceToken = {
        ...doc,
        accessToken: refreshed.accessToken,
        accessTokenExpiresAt: refreshed.accessTokenExpiresAt,
        refreshToken: refreshed.refreshToken ?? doc.refreshToken,
        updatedAt: new Date(now()).toISOString(),
      };
      await firestore.doc(docPath(uid)).set(updated);
      return updated.accessToken;
    } catch {
      // Refresh failed — user revoked at Google's end, or the refresh token
      // expired. Delete the doc so the state machine drops us back to
      // google_linked on the next turn, and surface a typed error so the
      // tool handler maps it to scope_required.
      await del(uid).catch(() => undefined);
      throw new ScopeRequiredError();
    }
  }

  async function getValidAccessToken(uid: string): Promise<string> {
    const doc = await get(uid);
    if (!doc || !doc.refreshToken) {
      throw new ScopeRequiredError();
    }
    const expiresAt = Date.parse(doc.accessTokenExpiresAt);
    if (Number.isFinite(expiresAt) && expiresAt > now() + skewMs) {
      return doc.accessToken;
    }
    const existing = refreshLocks.get(uid);
    if (existing) return existing;
    const inflight = doRefresh(uid, doc).finally(() => refreshLocks.delete(uid));
    refreshLocks.set(uid, inflight);
    return inflight;
  }

  return { get, set, delete: del, getValidAccessToken };
}
