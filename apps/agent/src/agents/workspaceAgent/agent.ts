import { type FunctionTool, LlmAgent } from '@google/adk';
import type * as z from 'zod';
import type { WorkspaceTokensStore } from '../../storage/workspaceTokens.js';
import type { ExecFileLike } from './gwsExec.js';
import type { RunGwsLogEvent } from './runGws.js';
import { createAddCalendarEventTool } from './tools/addCalendarEvent.js';
import { createAddTaskTool } from './tools/addTask.js';
import { createArchiveMessagesTool } from './tools/archiveMessages.js';
import { createCompleteTaskTool } from './tools/completeTask.js';
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
  /** Override agent name. Default WORKSPACE_AGENT_NAME. */
  name?: string;
  /** Override agent description (shown to the parent agent). */
  description?: string;
  /** Override system instruction. Default WORKSPACE_AGENT_INSTRUCTION. */
  instruction?: string;
  /**
   * Optional Zod schema describing the JSON shape the parent agent passes
   * via `AgentTool`. Setting this is REQUIRED whenever the AgentTool
   * wrapper expects structured args; otherwise ADK falls back to a
   * generic `{ request: string }` shape and the LLM has to invent that
   * key, which leads to empty/undefined inner messages.
   */
  inputSchema?: z.ZodObject<z.ZodRawShape>;
}

const DEFAULT_DESCRIPTION =
  "Reads the user's Google Workspace data (Gmail / Calendar / Tasks) and returns structured answers.";

export function createWorkspaceAgent(deps: CreateWorkspaceAgentDeps): LlmAgent {
  const tools = buildWorkspaceAgentTools(deps);
  return new LlmAgent({
    name: deps.name ?? WORKSPACE_AGENT_NAME,
    model: deps.model ?? WORKSPACE_AGENT_MODEL,
    description: deps.description ?? DEFAULT_DESCRIPTION,
    instruction: deps.instruction ?? WORKSPACE_AGENT_INSTRUCTION,
    // ADK ships with its own pinned zod copy in node_modules — the
    // ZodObject we hand it from our workspace's zod is structurally
    // identical but nominally distinct. ADK accepts ZodObject at
    // runtime; the cast is purely a TS-side bridge.
    // biome-ignore lint/suspicious/noExplicitAny: cross-zod-instance bridge
    ...(deps.inputSchema ? { inputSchema: deps.inputSchema as any } : {}),
    tools,
    // Sub-agent stays in its tool budget — never escapes to the parent
    // or to a sibling.
    disallowTransferToParent: true,
    disallowTransferToPeers: true,
  });
}

/**
 * Returns the array of internal tools the sub-agent uses (5 reads + 4
 * writes). The same write FunctionTool instances are also exposed on the
 * main agent via the workspace module's index factory; the main-side
 * exposure keeps single-step writes off the sub-agent's LLM hop, while
 * having them in the sub-agent's toolset lets a future "act inline"
 * prompt run end-to-end inside the sub-agent if/when we want that.
 */
export function buildWorkspaceAgentTools(deps: CreateWorkspaceAgentDeps): FunctionTool[] {
  return buildWorkspaceAgentReadTools(deps).concat(buildWorkspaceAgentWriteTools(deps));
}

export function buildWorkspaceAgentReadTools(deps: CreateWorkspaceAgentDeps): FunctionTool[] {
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

export function buildWorkspaceAgentWriteTools(deps: CreateWorkspaceAgentDeps): FunctionTool[] {
  const sharedDeps = {
    store: deps.store,
    uid: deps.uid,
    execFile: deps.execFile,
    log: deps.log,
  };
  return [
    createArchiveMessagesTool(sharedDeps),
    createAddCalendarEventTool(sharedDeps),
    createAddTaskTool(sharedDeps),
    createCompleteTaskTool(sharedDeps),
  ];
}
