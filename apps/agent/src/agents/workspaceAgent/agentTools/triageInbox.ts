import { AgentTool } from '@google/adk';
import { type TriageReport, TriageReportSchema } from '@lifecoach/shared-types';
import { z } from 'zod';
import { type CreateWorkspaceAgentDeps, createWorkspaceAgent } from '../agent.js';

/**
 * `triage_inbox` AgentTool. Wraps a dedicated `triage_inbox`-named
 * sub-agent (own LlmAgent instance, same tools, custom instruction
 * scoped to the triage flow). Main agent invokes it and gets back a
 * `<TRIAGE_REPORT>{json}</TRIAGE_REPORT>` blob the wrapper parses out.
 */

export const TRIAGE_INBOX_TOOL_NAME = 'triage_inbox';

const TRIAGE_DESCRIPTION =
  'Use when the user is starting their day or asks to triage their inbox. Returns a structured triage report classifying messages into noise/actions/events/info buckets. Read-only — does NOT archive or modify anything; the parent agent calls archive_messages after the user confirms.';

const TRIAGE_INSTRUCTION = `You are the inbox-triage sub-agent for a coaching assistant.

The parent will hand you a JSON message such as {} or {"since":"1d"} — parse it and use the "since" key (default "1d") as the inbox window.

Procedure:
1. Call list_inbox({ since }) to get message ids + snippets.
2. For each message, call get_message({ id }) to read the decoded body and headers. Parallel calls are fine.
3. Classify EVERY message into exactly one bucket:
   - noise: newsletters, automated reports, marketing — no action
   - actions: the user must do something — distil into a 1-line task
   - events: a meeting/appointment with date+time — propose start/end
   - info: factual updates touching a known goal/profile fact — short note

For events with a clear date+time, infer proposedStart (RFC3339 with timezone) and proposedEnd if known. Default duration 30 min.

DO NOT call any write tools. The parent agent owns confirmations and writes.

Final answer: emit ONLY a single line of the form
<TRIAGE_REPORT>{ "noise": [...], "actions": [...], "events": [...], "info": [...] }</TRIAGE_REPORT>
matching this schema:
- noise:   { id, threadId?, from, subject }
- actions: { id, threadId?, from, subject, task }
- events:  { id, threadId?, subject, proposedStart, proposedEnd?, location? }
- info:    { id, threadId?, from, subject, note }

Be terse. The parent agent will paraphrase.`;

export interface TriageInboxToolResult {
  status: 'ok' | 'parse_error';
  report?: TriageReport;
  raw: string;
}

const TRIAGE_INPUT_SCHEMA = z.object({
  since: z
    .string()
    .optional()
    .describe('Gmail-style relative window (e.g. "1d", "12h", "3d"). Default "1d".'),
});

export function createTriageInboxTool(deps: CreateWorkspaceAgentDeps): AgentTool {
  const agent = createWorkspaceAgent({
    ...deps,
    name: TRIAGE_INBOX_TOOL_NAME,
    description: TRIAGE_DESCRIPTION,
    instruction: TRIAGE_INSTRUCTION,
    inputSchema: TRIAGE_INPUT_SCHEMA,
  });
  return new AgentTool({ agent, skipSummarization: false });
}

const MARKER_RE = /<TRIAGE_REPORT>([\s\S]*?)<\/TRIAGE_REPORT>/;

/**
 * Parse the sub-agent's free-text answer into a validated TriageReport.
 * Exposed for the AgentTool runtime + tests; on parse-miss returns
 * `{status:'parse_error', raw}` so the parent agent can fall back to
 * narrating the raw text.
 */
export function parseTriageReport(text: string): TriageInboxToolResult {
  const match = text.match(MARKER_RE);
  const inner = match?.[1];
  if (!inner) {
    return { status: 'parse_error', raw: text };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(inner.trim());
  } catch {
    return { status: 'parse_error', raw: text };
  }
  const result = TriageReportSchema.safeParse(parsed);
  if (!result.success) {
    return { status: 'parse_error', raw: text };
  }
  return { status: 'ok', report: result.data, raw: text };
}
