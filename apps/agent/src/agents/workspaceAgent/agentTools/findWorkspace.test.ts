import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceTokensStore } from '../../../storage/workspaceTokens.js';
import { FIND_WORKSPACE_TOOL_NAME, createFindWorkspaceTool } from './findWorkspace.js';

function fakeStore(): WorkspaceTokensStore {
  return {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(async () => undefined),
    getValidAccessToken: vi.fn(async () => 'ya29.fake'),
  };
}

describe('find_workspace AgentTool', () => {
  it('exposes the expected name and description (inherited from the wrapped agent)', () => {
    const tool = createFindWorkspaceTool({ store: fakeStore(), uid: 'u' });
    expect(tool.name).toBe(FIND_WORKSPACE_TOOL_NAME);
    expect(tool.description.toLowerCase()).toContain('look up');
    expect(tool.description.toLowerCase()).toContain('read-only');
  });

  it('description steers callers away from triage', () => {
    const tool = createFindWorkspaceTool({ store: fakeStore(), uid: 'u' });
    expect(tool.description).toMatch(/triage_inbox/);
  });
});
