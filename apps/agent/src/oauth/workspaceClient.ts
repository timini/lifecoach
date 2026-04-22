import { OAuth2Client } from 'google-auth-library';

/**
 * Token material held by the application server. Never reaches the LLM.
 * Stored in Firestore by the workspaceTokens store; retrieved only inside
 * tool *handlers*, used to bind auth to outgoing Google API calls.
 */
export interface WorkspaceTokens {
  accessToken: string;
  accessTokenExpiresAt: string; // ISO
  refreshToken: string;
  scopes: string[];
}

/**
 * Minimal surface of `google-auth-library`'s OAuth2Client that we use.
 * Keeping it narrow + tests-friendly: factory takes a `clientFactory`
 * function so tests can inject a fake OAuth2Client without touching the
 * network.
 */
export interface WorkspaceOAuthClientLike {
  getToken(code: string): Promise<{
    tokens: {
      access_token?: string | null;
      refresh_token?: string | null;
      expiry_date?: number | null;
      scope?: string | null;
    };
  }>;
  refreshAccessToken(refreshToken: string): Promise<{
    credentials: {
      access_token?: string | null;
      refresh_token?: string | null;
      expiry_date?: number | null;
    };
  }>;
  revokeToken(token: string): Promise<unknown>;
}

/**
 * Real-library factory. Exported for the main runtime; tests construct
 * `createWorkspaceOAuthClient` with a fake implementation of the `Like`
 * interface above.
 */
export function createRealWorkspaceOAuthClient(deps: {
  clientId: string;
  clientSecret: string;
  /** Only needed for offline redirect-based flows; GIS popup uses `postmessage`. */
  redirectUri?: string;
}): WorkspaceOAuthClientLike {
  const client = new OAuth2Client({
    clientId: deps.clientId,
    clientSecret: deps.clientSecret,
    redirectUri: deps.redirectUri ?? 'postmessage',
  });
  return {
    getToken: (code) => client.getToken(code),
    refreshAccessToken: async (refreshToken) => {
      const scoped = new OAuth2Client({
        clientId: deps.clientId,
        clientSecret: deps.clientSecret,
      });
      scoped.setCredentials({ refresh_token: refreshToken });
      const { credentials } = await scoped.refreshAccessToken();
      return { credentials };
    },
    revokeToken: (token) => client.revokeToken(token),
  };
}

export interface WorkspaceOAuthClient {
  /** Exchange an auth code (from the browser's GIS popup) for tokens. */
  exchangeCode(code: string): Promise<WorkspaceTokens>;
  /** Refresh the access token using a stored refresh token. */
  refreshAccessToken(refreshToken: string): Promise<{
    accessToken: string;
    accessTokenExpiresAt: string;
    /** Google may rotate the refresh token — if present, overwrite. */
    refreshToken?: string;
  }>;
  /** Best-effort revoke at Google's end. */
  revokeRefreshToken(refreshToken: string): Promise<void>;
}

export function createWorkspaceOAuthClient(deps: {
  client: WorkspaceOAuthClientLike;
  /** Injected for tests; defaults to Date.now(). */
  now?: () => number;
}): WorkspaceOAuthClient {
  const client = deps.client;
  const now = deps.now ?? Date.now;

  function expiryIso(expiryDate: number | null | undefined): string {
    // expiry_date from google-auth-library is ms-since-epoch.
    if (typeof expiryDate === 'number' && Number.isFinite(expiryDate)) {
      return new Date(expiryDate).toISOString();
    }
    // Fallback: assume 55 minutes to play it safe (Google defaults to 60m).
    return new Date(now() + 55 * 60 * 1000).toISOString();
  }

  return {
    async exchangeCode(code) {
      const { tokens } = await client.getToken(code);
      if (!tokens.access_token || !tokens.refresh_token) {
        throw new Error('oauth-exchange: missing access_token or refresh_token in response');
      }
      return {
        accessToken: tokens.access_token,
        accessTokenExpiresAt: expiryIso(tokens.expiry_date),
        refreshToken: tokens.refresh_token,
        scopes: (tokens.scope ?? '').split(/\s+/).filter(Boolean),
      };
    },
    async refreshAccessToken(refreshToken) {
      const { credentials } = await client.refreshAccessToken(refreshToken);
      if (!credentials.access_token) {
        throw new Error('oauth-refresh: missing access_token in response');
      }
      return {
        accessToken: credentials.access_token,
        accessTokenExpiresAt: expiryIso(credentials.expiry_date),
        refreshToken: credentials.refresh_token ?? undefined,
      };
    },
    async revokeRefreshToken(refreshToken) {
      try {
        await client.revokeToken(refreshToken);
      } catch {
        // Best-effort: if Google says the token's already revoked, it'll
        // throw. Swallow — the DELETE-doc path has already succeeded.
      }
    },
  };
}
