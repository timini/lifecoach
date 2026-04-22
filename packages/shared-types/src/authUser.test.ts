import { describe, expect, it } from 'vitest';
import { AUTH_MODES, AUTH_USER_TOOL_NAME, AuthUserArgsSchema } from './authUser.js';

describe('AuthUserArgsSchema', () => {
  it('accepts mode:google with no email', () => {
    expect(AuthUserArgsSchema.parse({ mode: 'google' })).toEqual({ mode: 'google' });
  });

  it('accepts mode:email with a valid email', () => {
    expect(AuthUserArgsSchema.parse({ mode: 'email', email: 'tim@example.com' })).toEqual({
      mode: 'email',
      email: 'tim@example.com',
    });
  });

  it('rejects invalid email format', () => {
    expect(() => AuthUserArgsSchema.parse({ mode: 'email', email: 'not-an-email' })).toThrow();
  });

  it('rejects unknown mode', () => {
    expect(() => AuthUserArgsSchema.parse({ mode: 'sms' })).toThrow();
  });

  it('rejects unknown top-level keys', () => {
    expect(() => AuthUserArgsSchema.parse({ mode: 'google', extra: 'nope' })).toThrow();
  });

  it('exposes the canonical modes and tool name', () => {
    expect(AUTH_MODES).toEqual(['google', 'email']);
    expect(AUTH_USER_TOOL_NAME).toBe('auth_user');
  });
});
