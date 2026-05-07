import { FunctionTool } from '@google/adk';
import { z } from 'zod';
import type { WorkspaceTokensStore } from '../../../storage/workspaceTokens.js';
import type { ExecFileLike } from '../gwsExec.js';
import { type RunGwsLogEvent, runGws } from '../runGws.js';

/**
 * `list_inbox` — sub-agent's read tool for "what's in the inbox right
 * now". Returns bare summaries (id, threadId, snippet) — no body.
 * The sub-agent calls `get_message` per id when it needs the full
 * content (typically only for non-trivial messages it wants to triage).
 */

export const LIST_INBOX_TOOL_NAME = 'list_inbox';

export interface CreateListInboxToolDeps {
  store: WorkspaceTokensStore;
  uid: string;
  execFile?: ExecFileLike;
  log?: (event: RunGwsLogEvent) => void;
}

export interface InboxMessageSummary {
  id: string;
  threadId: string;
  snippet: string;
}

export type ListInboxResult =
  | { status: 'ok'; messages: InboxMessageSummary[]; truncated?: boolean }
  | { status: 'error'; code: string; message: string };

const parameters = z.object({
  unreadOnly: z.boolean().optional().describe('When true, restrict to unread messages only.'),
  since: z
    .string()
    .optional()
    .describe(
      'Gmail-style relative window (e.g. "1d", "12h", "3d"). Default "1d" — last 24 hours.',
    ),
  limit: z
    .number()
    .int()
    .positive()
    .max(50)
    .optional()
    .describe('Maximum number of messages to return (1–50). Default 15.'),
});

interface ListResponse {
  messages?: { id?: string; threadId?: string }[];
}

interface MessageMetadata {
  id?: string;
  threadId?: string;
  snippet?: string;
}

export function createListInboxTool(deps: CreateListInboxToolDeps): FunctionTool {
  const { store, uid, execFile, log } = deps;

  // biome-ignore lint/suspicious/noExplicitAny: zod nominal mismatch with ADK generics
  return new FunctionTool<any>({
    name: LIST_INBOX_TOOL_NAME,
    description:
      'List recent inbox messages as id+threadId+snippet summaries (no body). Use get_message per id to read full content. Read-only.',
    parameters,
    execute: async (input: unknown): Promise<ListInboxResult> => {
      const args = input as { unreadOnly?: boolean; since?: string; limit?: number };
      const since = args.since ?? '1d';
      const maxResults = args.limit ?? 15;
      const q = `${args.unreadOnly ? 'is:unread ' : ''}label:INBOX newer_than:${since}`.trim();

      const listResult = await runGws({
        store,
        uid,
        toolName: LIST_INBOX_TOOL_NAME,
        service: 'gmail',
        resource: 'users.messages',
        method: 'list',
        params: { userId: 'me', q, maxResults },
        execFile,
        log,
      });
      if (listResult.status === 'error') {
        return { status: 'error', code: listResult.code, message: listResult.message };
      }
      const listBody = (listResult.body as ListResponse | null) ?? {};
      const ids = (listBody.messages ?? [])
        .map((m) => m.id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0);
      if (ids.length === 0) {
        return { status: 'ok', messages: [] };
      }

      // Fetch metadata-format snippets in parallel for the listed ids.
      // metadata format avoids base64 bodies entirely — we only need snippets here.
      const detailResults = await Promise.all(
        ids.map((id) =>
          runGws({
            store,
            uid,
            toolName: LIST_INBOX_TOOL_NAME,
            service: 'gmail',
            resource: 'users.messages',
            method: 'get',
            params: { userId: 'me', id, format: 'metadata' },
            execFile,
            log,
          }),
        ),
      );

      const messages: InboxMessageSummary[] = [];
      for (const detail of detailResults) {
        if (detail.status !== 'ok') continue;
        const m = (detail.body as MessageMetadata | null) ?? {};
        if (!m.id) continue;
        messages.push({
          id: m.id,
          threadId: m.threadId ?? m.id,
          snippet: m.snippet ?? '',
        });
      }
      // listResult.status is 'ok' here (errored earlier).
      return listResult.status === 'ok' && listResult.truncated
        ? { status: 'ok', messages, truncated: true }
        : { status: 'ok', messages };
    },
  });
}
