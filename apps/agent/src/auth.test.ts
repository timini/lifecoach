import { describe, expect, it, vi } from 'vitest';
import { type TokenVerifier, bearerTokenFrom, verifyRequest } from './auth.js';

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
