import { describe, expect, it, vi } from 'vitest';
import {
  type TokenVerifier,
  bearerTokenFrom,
  claimsToFirebaseUserLike,
  verifyRequest,
} from './auth.js';

describe('bearerTokenFrom', () => {
  it('extracts the token from a Bearer header', () => {
    expect(bearerTokenFrom('Bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(bearerTokenFrom('bearer abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('returns null for missing or malformed header', () => {
    expect(bearerTokenFrom(undefined)).toBeNull();
    expect(bearerTokenFrom('')).toBeNull();
    expect(bearerTokenFrom('Basic xyz')).toBeNull();
    expect(bearerTokenFrom('Bearer')).toBeNull();
  });
});

describe('verifyRequest', () => {
  it('returns the decoded claims when the verifier succeeds', async () => {
    const verifier: TokenVerifier = vi.fn().mockResolvedValue({
      uid: 'u123',
      firebase: { sign_in_provider: 'anonymous' },
    });
    const claims = await verifyRequest({ authorization: 'Bearer tok' }, verifier);
    expect(claims).toEqual({ uid: 'u123', firebase: { sign_in_provider: 'anonymous' } });
    expect(verifier).toHaveBeenCalledWith('tok');
  });

  it('returns null when no Bearer token is present', async () => {
    const verifier: TokenVerifier = vi.fn();
    const claims = await verifyRequest({}, verifier);
    expect(claims).toBeNull();
    expect(verifier).not.toHaveBeenCalled();
  });

  it('returns null when the verifier rejects', async () => {
    const verifier: TokenVerifier = vi.fn().mockRejectedValue(new Error('expired'));
    const claims = await verifyRequest({ authorization: 'Bearer tok' }, verifier);
    expect(claims).toBeNull();
  });
});

describe('claimsToFirebaseUserLike', () => {
  it('maps an anonymous provider to isAnonymous=true', () => {
    const fbu = claimsToFirebaseUserLike(
      { uid: 'u', firebase: { sign_in_provider: 'anonymous' } },
      false,
    );
    expect(fbu).toEqual({
      isAnonymous: true,
      emailVerified: false,
      providerData: [],
      workspaceScopesGranted: false,
    });
  });

  it('maps a password provider to providerData=[{password}]', () => {
    const fbu = claimsToFirebaseUserLike(
      { uid: 'u', email_verified: true, firebase: { sign_in_provider: 'password' } },
      false,
    );
    expect(fbu.providerData).toContainEqual({ providerId: 'password' });
    expect(fbu.emailVerified).toBe(true);
    expect(fbu.isAnonymous).toBe(false);
  });

  it('maps a google.com provider (and workspaceScopesGranted=true)', () => {
    const fbu = claimsToFirebaseUserLike(
      {
        uid: 'u',
        email_verified: true,
        firebase: { sign_in_provider: 'google.com' },
      },
      true,
    );
    expect(fbu.providerData).toContainEqual({ providerId: 'google.com' });
    expect(fbu.workspaceScopesGranted).toBe(true);
  });

  it('reads identities as secondary signal for password/google', () => {
    const fbu = claimsToFirebaseUserLike(
      {
        uid: 'u',
        firebase: {
          sign_in_provider: 'custom',
          identities: { email: ['u@example.com'], 'google.com': ['123'] },
        },
      },
      false,
    );
    expect(fbu.providerData).toContainEqual({ providerId: 'password' });
    expect(fbu.providerData).toContainEqual({ providerId: 'google.com' });
  });

  it('handles missing firebase claim gracefully', () => {
    const fbu = claimsToFirebaseUserLike({ uid: 'u' }, false);
    expect(fbu.isAnonymous).toBe(false);
    expect(fbu.providerData).toEqual([]);
  });
});
