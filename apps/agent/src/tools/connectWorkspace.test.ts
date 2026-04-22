import { describe, expect, it } from 'vitest';
import { CONNECT_WORKSPACE_TOOL_NAME, createConnectWorkspaceTool } from './connectWorkspace.js';

function exec(tool: ReturnType<typeof createConnectWorkspaceTool>) {
  // biome-ignore lint/suspicious/noExplicitAny: ADK tool internals
  return (tool as any).execute({});
}

describe('connect_workspace tool', () => {
  it('is named and description forbids trailing text', () => {
    const t = createConnectWorkspaceTool();
    expect(t.name).toBe(CONNECT_WORKSPACE_TOOL_NAME);
    expect(t.description.toLowerCase()).toContain('no additional text');
  });

  it('returns {status: oauth_prompted} with no auth values', async () => {
    const r = await exec(createConnectWorkspaceTool());
    expect(r).toEqual({ status: 'oauth_prompted' });
    // Belt-and-braces: the LLM must never see tokens/codes in the result.
    const json = JSON.stringify(r);
    expect(json).not.toMatch(/access_token|refresh_token|client_secret|code/i);
  });
});
