import { describe, expect, it } from 'vitest';
import { createAuthUserTool } from './authUser.js';

function exec(tool: ReturnType<typeof createAuthUserTool>, input: unknown) {
  // biome-ignore lint/suspicious/noExplicitAny: ADK tool internals
  return (tool as any).execute(input);
}

describe('auth_user tool', () => {
  it('is named and description tells model to not rephrase', () => {
    const t = createAuthUserTool();
    expect(t.name).toBe('auth_user');
    expect(t.description.toLowerCase()).toContain('no additional text');
    expect(t.description.toLowerCase()).toContain('anonymous');
  });

  it('returns {status:auth_prompted, mode:google} for google mode', async () => {
    const r = await exec(createAuthUserTool(), { mode: 'google' });
    expect(r).toEqual({ status: 'auth_prompted', mode: 'google' });
  });

  it('passes email through for mode:email', async () => {
    const r = await exec(createAuthUserTool(), { mode: 'email', email: 'tim@example.com' });
    expect(r).toEqual({
      status: 'auth_prompted',
      mode: 'email',
      email: 'tim@example.com',
    });
  });

  it('omits email when not provided', async () => {
    const r = await exec(createAuthUserTool(), { mode: 'email' });
    expect(r).toEqual({ status: 'auth_prompted', mode: 'email' });
  });
});
