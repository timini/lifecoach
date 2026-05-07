import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceTokensStore } from '../../storage/workspaceTokens.js';
import {
  ADD_CALENDAR_EVENT_TOOL_NAME,
  ADD_TASK_TOOL_NAME,
  ARCHIVE_MESSAGES_TOOL_NAME,
  COMPLETE_TASK_TOOL_NAME,
  FIND_WORKSPACE_TOOL_NAME,
  TRIAGE_INBOX_TOOL_NAME,
  createWorkspaceTools,
} from './index.js';

function fakeStore(): WorkspaceTokensStore {
  return {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(async () => undefined),
    getValidAccessToken: vi.fn(async () => 'ya29.fake'),
  };
}

describe('createWorkspaceTools', () => {
  it('returns the 6 main-facing tools in the expected order', () => {
    const tools = createWorkspaceTools({ store: fakeStore(), uid: 'u' });
    expect(tools.map((t) => t.name)).toEqual([
      TRIAGE_INBOX_TOOL_NAME,
      FIND_WORKSPACE_TOOL_NAME,
      ARCHIVE_MESSAGES_TOOL_NAME,
      ADD_CALENDAR_EVENT_TOOL_NAME,
      ADD_TASK_TOOL_NAME,
      COMPLETE_TASK_TOOL_NAME,
    ]);
  });

  it('each tool has a non-empty description', () => {
    const tools = createWorkspaceTools({ store: fakeStore(), uid: 'u' });
    for (const t of tools) {
      expect(t.description.length).toBeGreaterThan(20);
    }
  });
});
