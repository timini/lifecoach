import { type FunctionTool, LlmAgent } from '@google/adk';
import type { WorkspaceTokensStore } from '../../storage/workspaceTokens.js';
import type { ExecFileLike } from './gwsExec.js';
import type { RunGwsLogEvent } from './runGws.js';
import { createGetMessageTool } from './tools/getMessage.js';
import { createListEventsTool } from './tools/listEvents.js';
import { createListInboxTool } from './tools/listInbox.js';
import { createListTasksTool } from './tools/listTasks.js';
import { createSearchMessagesTool } from './tools/searchMessages.js';

/**
 * The Google Workspace sub-agent — a Flash-backed LlmAgent with narrow,
 * read-only internal tools. Wrapped by AgentTool entry points (triage_inbox,
 * find_workspace) the main coach agent sees.
 *
 * Future commits add the four write tools (archive_messages,
 * add_calendar_event, add_task, complete_task) to its toolset so the sub-
 * agent can act inline when the parent's invocation explicitly authorises
 * a write.
 */

export const WORKSPACE_AGENT_NAME = 'workspace-agent';
// Same model as the parent coach. Flash is fast enough for triage and
// already on Vertex location=global. Re-evaluate vs Flash Lite after
// dogfood telemetry lands.
export const WORKSPACE_AGENT_MODEL = 'gemini-3-flash-preview';

export const WORKSPACE_AGENT_INSTRUCTION = `You are a sub-agent for Google Workspace (Gmail, Calendar, Google Tasks).

You receive a query from the parent coach agent. Use your tools to gather the data needed and return a clean, structured answer matching the schema requested in the query.

Rules:
- Read-only: never write or modify Workspace data. (Write tools are not yet in your toolset; even when they are, only call them if the parent's invocation explicitly authorises a write.)
- Do not ask the user questions; the parent agent owns conversation. Return your answer in the requested format and stop.
- Be terse. The parent agent will paraphrase what you return.
- When the query asks for a TRIAGE_REPORT or other markered JSON, emit it inside <TRIAGE_REPORT>{json}</TRIAGE_REPORT> tags exactly. Do not pretty-print; minified JSON is fine.
- If a tool call returns status:'error', incorporate the error into your final answer (the parent agent maps error codes to user-facing messages).`;

export interface CreateWorkspaceAgentDeps {
  store: WorkspaceTokensStore;
  uid: string;
  execFile?: ExecFileLike;
  log?: (event: RunGwsLogEvent) => void;
  /** Override model, e.g. for tests. Default WORKSPACE_AGENT_MODEL. */
  model?: string;
}

export function createWorkspaceAgent(deps: CreateWorkspaceAgentDeps): LlmAgent {
  const tools = buildWorkspaceAgentTools(deps);
  return new LlmAgent({
    name: WORKSPACE_AGENT_NAME,
    model: deps.model ?? WORKSPACE_AGENT_MODEL,
    description:
      "Reads the user's Google Workspace data (Gmail / Calendar / Tasks) and returns structured answers. Read-only.",
    instruction: WORKSPACE_AGENT_INSTRUCTION,
    tools,
    // Sub-agent stays in its tool budget — never escapes to the parent
    // or to a sibling.
    disallowTransferToParent: true,
    disallowTransferToPeers: true,
  });
}

/**
 * Returns the array of internal tools the sub-agent uses. Exported for
 * the unit test that asserts the toolset; the next commit extends this to
 * include the write tools shared with main.
 */
export function buildWorkspaceAgentTools(deps: CreateWorkspaceAgentDeps): FunctionTool[] {
  const sharedDeps = {
    store: deps.store,
    uid: deps.uid,
    execFile: deps.execFile,
    log: deps.log,
  };
  return [
    createListInboxTool(sharedDeps),
    createGetMessageTool(sharedDeps),
    createSearchMessagesTool(sharedDeps),
    createListEventsTool(sharedDeps),
    createListTasksTool(sharedDeps),
  ];
}
