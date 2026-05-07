import { AgentTool } from '@google/adk';
import { z } from 'zod';
import { type CreateWorkspaceAgentDeps, createWorkspaceAgent } from '../agent.js';

/**
 * `find_workspace` AgentTool — ad-hoc lookup across Gmail / Calendar /
 * Tasks. Wraps a dedicated `find_workspace`-named LlmAgent instance with
 * a search-flavoured instruction. Returns natural-language text plus
 * resource ids (so the parent can act on them).
 */

export const FIND_WORKSPACE_TOOL_NAME = 'find_workspace';

const FIND_DESCRIPTION =
  'Use to look up specific information across the user\'s Gmail / Calendar / Tasks (e.g. "Sarah\'s email last week", "what\'s on Thursday afternoon", "open tasks for the project review"). Do NOT use for inbox triage — call triage_inbox for that. Returns a natural-language answer with relevant ids/links. Read-only.';

const FIND_INSTRUCTION = `You are the workspace-search sub-agent for a coaching assistant.

The parent will hand you a JSON message of the form {"query":"..."} — parse it and treat the "query" string as a natural-language request asking for specific information across Gmail, Calendar, and Google Tasks.

Procedure:
1. Pick the right read tool(s):
   - Gmail content / threads: search_messages with Gmail query syntax (from:, subject:, newer_than:, label:starred, etc).
   - Specific message body: get_message with the id.
   - Calendar in a window: list_events with timeMin/timeMax (RFC3339).
   - Tasks: list_tasks (showCompleted as needed).
2. Use as few tool calls as possible. If a single search/list answers the question, stop there.
3. Do NOT call any write tools. The parent agent owns confirmations and writes.

Final answer: a short natural-language answer (≤4 sentences) that:
- Cites each fact with a resource id in brackets, e.g. "Sarah confirmed lunch on Tuesday [m:18a4f1b] and the parent-teacher slot is 6pm [ev:4kr2…]."
- If you used calendar/event ids, prefix with "ev:". For message ids, prefix with "m:". For task ids, "t:".
- If the answer is "nothing matched", say so directly.

Be terse. The parent agent will paraphrase.`;

const FIND_INPUT_SCHEMA = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      'Natural-language question — e.g. "Sarah\'s email last week", "what\'s Thursday afternoon".',
    ),
});

export function createFindWorkspaceTool(deps: CreateWorkspaceAgentDeps): AgentTool {
  const agent = createWorkspaceAgent({
    ...deps,
    name: FIND_WORKSPACE_TOOL_NAME,
    description: FIND_DESCRIPTION,
    instruction: FIND_INSTRUCTION,
    inputSchema: FIND_INPUT_SCHEMA,
  });
  return new AgentTool({ agent, skipSummarization: false });
}
