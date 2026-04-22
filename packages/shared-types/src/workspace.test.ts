import { describe, expect, it } from 'vitest';
import { WORKSPACE_SCOPES, WorkspaceStatusSchema } from './workspace.js';

describe('WORKSPACE_SCOPES', () => {
  it('includes full Gmail + Calendar + Tasks scopes', () => {
    expect(WORKSPACE_SCOPES).toContain('https://mail.google.com/');
    expect(WORKSPACE_SCOPES).toContain('https://www.googleapis.com/auth/calendar');
    expect(WORKSPACE_SCOPES).toContain('https://www.googleapis.com/auth/tasks');
  });

  it('does not include scopes we intentionally excluded', () => {
    for (const scope of WORKSPACE_SCOPES) {
      expect(scope).not.toMatch(/drive/);
      expect(scope).not.toMatch(/spreadsheets/);
    }
  });
});

describe('WorkspaceStatusSchema', () => {
  it('accepts a connected status', () => {
    const parsed = WorkspaceStatusSchema.parse({
      connected: true,
      scopes: Array.from(WORKSPACE_SCOPES),
      grantedAt: new Date().toISOString(),
    });
    expect(parsed.connected).toBe(true);
  });

  it('accepts a disconnected status (grantedAt null)', () => {
    const parsed = WorkspaceStatusSchema.parse({
      connected: false,
      scopes: [],
      grantedAt: null,
    });
    expect(parsed.connected).toBe(false);
  });

  it('rejects shapes that leak token fields', () => {
    // Belt-and-braces: WorkspaceStatus must never be used to carry auth values.
    // A status shape with accessToken should be a Zod parse failure, not a
    // silently-passed extra field.
    expect(() =>
      WorkspaceStatusSchema.parse({
        connected: true,
        scopes: [],
        grantedAt: null,
        accessToken: 'ya29.should-not-be-here',
      }),
    ).toThrow();
  });
});
