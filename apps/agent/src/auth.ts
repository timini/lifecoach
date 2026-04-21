import type { FirebaseUserLike } from '@lifecoach/user-state';

/**
 * Minimal subset of firebase-admin's DecodedIdToken that we actually use.
 */
export interface VerifiedClaims {
  uid: string;
  email?: string;
  email_verified?: boolean;
  firebase?: {
    sign_in_provider?: string;
    identities?: Record<string, string[] | undefined>;
  };
}

export type TokenVerifier = (token: string) => Promise<VerifiedClaims>;

export function bearerTokenFrom(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header);
  return m?.[1] ? m[1].trim() : null;
}

export async function verifyRequest(
  headers: { authorization?: string },
  verifier: TokenVerifier,
): Promise<VerifiedClaims | null> {
  const token = bearerTokenFrom(headers.authorization);
  if (!token) return null;
  try {
    return await verifier(token);
  } catch {
    return null;
  }
}

/**
 * Map Firebase token claims into the structural shape the UserStateMachine
 * consumes. Keeps Firebase off the shared-types surface.
 */
export function claimsToFirebaseUserLike(
  claims: VerifiedClaims,
  workspaceScopesGranted: boolean,
): FirebaseUserLike {
  const provider = claims.firebase?.sign_in_provider ?? '';
  const identities = claims.firebase?.identities ?? {};
  const hasPassword = provider === 'password' || Boolean(identities.email);
  const hasGoogle = provider === 'google.com' || Boolean(identities['google.com']);

  return {
    isAnonymous: provider === 'anonymous',
    emailVerified: claims.email_verified === true,
    providerData: [
      ...(hasPassword ? [{ providerId: 'password' as const }] : []),
      ...(hasGoogle ? [{ providerId: 'google.com' as const }] : []),
    ],
    workspaceScopesGranted,
  };
}
