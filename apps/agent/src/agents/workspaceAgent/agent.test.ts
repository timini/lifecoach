import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceTokensStore } from '../../storage/workspaceTokens.js';
import {
  WORKSPACE_AGENT_INSTRUCTION,
  WORKSPACE_AGENT_MODEL,
  WORKSPACE_AGENT_NAME,
  buildWorkspaceAgentTools,
  createWorkspaceAgent,
} from './agent.js';
import { GET_MESSAGE_TOOL_NAME } from './tools/getMessage.js';
import { LIST_EVENTS_TOOL_NAME } from './tools/listEvents.js';
import { LIST_INBOX_TOOL_NAME } from './tools/listInbox.js';
import { LIST_TASKS_TOOL_NAME } from './tools/listTasks.js';
import { SEARCH_MESSAGES_TOOL_NAME } from './tools/searchMessages.js';

function fakeStore(): WorkspaceTokensStore {
  return {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(async () => undefined),
    getValidAccessToken: vi.fn(async () => 'ya29.fake'),
  };
}

describe('createWorkspaceAgent', () => {
  it('builds an LlmAgent with the expected name, model, description, and instruction', () => {
    const agent = createWorkspaceAgent({ store: fakeStore(), uid: 'u' });
    expect(agent.name).toBe(WORKSPACE_AGENT_NAME);
    // The ADK LlmAgent stores model in its config; description and
    // instruction strings are reachable via internal fields.
    // biome-ignore lint/suspicious/noExplicitAny: ADK internals
    const a = agent as any;
    expect(a.model ?? a.config?.model).toBe(WORKSPACE_AGENT_MODEL);
    expect(a.description ?? a.config?.description).toMatch(/google workspace/i);
    expect(a.instruction ?? a.config?.instruction).toBe(WORKSPACE_AGENT_INSTRUCTION);
  });

  it('disables transfer to parent and peers (sub-agent stays in its budget)', () => {
    const agent = createWorkspaceAgent({ store: fakeStore(), uid: 'u' });
    // biome-ignore lint/suspicious/noExplicitAny: ADK internals
    const a = agent as any;
    expect(a.disallowTransferToParent ?? a.config?.disallowTransferToParent).toBe(true);
    expect(a.disallowTransferToPeers ?? a.config?.disallowTransferToPeers).toBe(true);
  });

  it('honours a model override', () => {
    const agent = createWorkspaceAgent({
      store: fakeStore(),
      uid: 'u',
      model: 'gemini-3-flash-lite',
    });
    // biome-ignore lint/suspicious/noExplicitAny: ADK internals
    const a = agent as any;
    expect(a.model ?? a.config?.model).toBe('gemini-3-flash-lite');
  });
});

describe('buildWorkspaceAgentTools', () => {
  it('returns the five read tools in a stable order', () => {
    const tools = buildWorkspaceAgentTools({ store: fakeStore(), uid: 'u' });
    expect(tools.map((t) => t.name)).toEqual([
      LIST_INBOX_TOOL_NAME,
      GET_MESSAGE_TOOL_NAME,
      SEARCH_MESSAGES_TOOL_NAME,
      LIST_EVENTS_TOOL_NAME,
      LIST_TASKS_TOOL_NAME,
    ]);
  });

  it('every read tool description is read-only or includes "read-only"', () => {
    const tools = buildWorkspaceAgentTools({ store: fakeStore(), uid: 'u' });
    for (const t of tools) {
      expect(t.description.toLowerCase()).toContain('read-only');
    }
  });
});

describe('WORKSPACE_AGENT_INSTRUCTION', () => {
  it('directs the agent to be terse and read-only and not to ask the user questions', () => {
    expect(WORKSPACE_AGENT_INSTRUCTION).toMatch(/read-only/i);
    expect(WORKSPACE_AGENT_INSTRUCTION).toMatch(/never ask|do not ask/i);
    expect(WORKSPACE_AGENT_INSTRUCTION).toMatch(/be terse/i);
  });

  it('explains the TRIAGE_REPORT marker contract', () => {
    expect(WORKSPACE_AGENT_INSTRUCTION).toContain('<TRIAGE_REPORT>');
    expect(WORKSPACE_AGENT_INSTRUCTION).toContain('</TRIAGE_REPORT>');
  });
});
