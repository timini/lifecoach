import type { AgentTool, FunctionTool } from '@google/adk';
import type { WorkspaceTokensStore } from '../../storage/workspaceTokens.js';
import type { CreateWorkspaceAgentDeps } from './agent.js';
import { createFindWorkspaceTool } from './agentTools/findWorkspace.js';
import { createTriageInboxTool } from './agentTools/triageInbox.js';
import type { ExecFileLike } from './gwsExec.js';
import type { RunGwsLogEvent } from './runGws.js';
import { createAddCalendarEventTool } from './tools/addCalendarEvent.js';
import { createAddTaskTool } from './tools/addTask.js';
import { createArchiveMessagesTool } from './tools/archiveMessages.js';
import { createCompleteTaskTool } from './tools/completeTask.js';

/**
 * Workspace module entry point. The main agent imports this exactly
 * once and gates it on `userState === 'workspace_connected'`. The
 * returned array is everything the main agent needs to talk to Google
 * Workspace — the generic `call_workspace` dispatcher is gone.
 *
 * Returned tools, in order:
 *   1. triage_inbox()           — AgentTool wrapping the triage sub-agent
 *   2. find_workspace(query)    — AgentTool wrapping the search sub-agent
 *   3. archive_messages(ids)    — FunctionTool — direct, no LLM hop
 *   4. add_calendar_event(...)  — FunctionTool — direct, no LLM hop
 *   5. add_task(...)            — FunctionTool — direct, no LLM hop
 *   6. complete_task(id)        — FunctionTool — direct, no LLM hop
 *
 * The same write FunctionTool instances are also in the sub-agents'
 * tool arrays (so the sub-agent can act inline if a future prompt
 * authorises it). One auth/exec/projection path; two consumers; one
 * log line per call regardless of which side triggered it.
 */

export interface CreateWorkspaceToolsDeps {
  store: WorkspaceTokensStore;
  uid: string;
  execFile?: ExecFileLike;
  /**
   * Log emitter for tool invocations on the main agent (triage_inbox,
   * find_workspace, archive_messages, …). Receives the same shape every
   * gws-touching tool emits, so a single Cloud Logging filter pulls all
   * workspace traffic.
   */
  log?: (event: RunGwsLogEvent) => void;
  /**
   * Log emitter for the sub-agents' internal tool calls (list_inbox,
   * get_message, search_messages, list_events, list_tasks, plus any
   * write the sub-agent calls inline). Kept distinct so Cloud Logging
   * can split "what the main agent did" from "what the sub-agent did".
   */
  subAgentLog?: (event: RunGwsLogEvent) => void;
}

/** The set of tool names the workspace module exposes to the main agent. */
export type WorkspaceToolEntry = AgentTool | FunctionTool;

export function createWorkspaceTools(deps: CreateWorkspaceToolsDeps): WorkspaceToolEntry[] {
  const subAgentDeps: CreateWorkspaceAgentDeps = {
    store: deps.store,
    uid: deps.uid,
    execFile: deps.execFile,
    log: deps.subAgentLog,
  };
  const writeDeps = {
    store: deps.store,
    uid: deps.uid,
    execFile: deps.execFile,
    log: deps.log,
  };
  return [
    createTriageInboxTool(subAgentDeps),
    createFindWorkspaceTool(subAgentDeps),
    createArchiveMessagesTool(writeDeps),
    createAddCalendarEventTool(writeDeps),
    createAddTaskTool(writeDeps),
    createCompleteTaskTool(writeDeps),
  ];
}

// Re-exports for tests + future server.ts consumers.
export {
  createWorkspaceAgent,
  type CreateWorkspaceAgentDeps,
} from './agent.js';
export {
  TRIAGE_INBOX_TOOL_NAME,
  parseTriageReport,
} from './agentTools/triageInbox.js';
export { FIND_WORKSPACE_TOOL_NAME } from './agentTools/findWorkspace.js';
export { ARCHIVE_MESSAGES_TOOL_NAME } from './tools/archiveMessages.js';
export { ADD_CALENDAR_EVENT_TOOL_NAME } from './tools/addCalendarEvent.js';
export { ADD_TASK_TOOL_NAME } from './tools/addTask.js';
export { COMPLETE_TASK_TOOL_NAME } from './tools/completeTask.js';
