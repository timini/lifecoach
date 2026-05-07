import { FunctionTool } from '@google/adk';
import { z } from 'zod';
import type { WorkspaceTokensStore } from '../../../storage/workspaceTokens.js';
import type { ExecFileLike } from '../gwsExec.js';
import { type RunGwsLogEvent, runGws } from '../runGws.js';
import { type InboxMessageSummary, LIST_INBOX_TOOL_NAME } from './listInbox.js';

/**
 * `search_messages` — Gmail search across the whole mailbox, not just the
 * inbox. Same shape as list_inbox: returns id+threadId+snippet summaries,
 * sub-agent calls get_message for full bodies on the matches it cares
 * about.
 */

export const SEARCH_MESSAGES_TOOL_NAME = 'search_messages';

export interface CreateSearchMessagesToolDeps {
  store: WorkspaceTokensStore;
  uid: string;
  execFile?: ExecFileLike;
  log?: (event: RunGwsLogEvent) => void;
}

export type SearchMessagesResult =
  | { status: 'ok'; messages: InboxMessageSummary[]; truncated?: boolean }
  | { status: 'error'; code: string; message: string };

const parameters = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      'Gmail search syntax — e.g. "from:sarah newer_than:7d", "subject:invoice", "label:starred".',
    ),
  limit: z
    .number()
    .int()
    .positive()
    .max(50)
    .optional()
    .describe('Maximum number of messages to return (1–50). Default 10.'),
});

interface ListResponse {
  messages?: { id?: string; threadId?: string }[];
}

interface MessageMetadata {
  id?: string;
  threadId?: string;
  snippet?: string;
}

export function createSearchMessagesTool(deps: CreateSearchMessagesToolDeps): FunctionTool {
  const { store, uid, execFile, log } = deps;

  // biome-ignore lint/suspicious/noExplicitAny: zod nominal mismatch with ADK generics
  return new FunctionTool<any>({
    name: SEARCH_MESSAGES_TOOL_NAME,
    description:
      'Search Gmail across all labels/folders using Gmail query syntax. Returns id+threadId+snippet summaries — call get_message for full body. Read-only.',
    parameters,
    execute: async (input: unknown): Promise<SearchMessagesResult> => {
      const args = input as { query: string; limit?: number };
      const maxResults = args.limit ?? 10;

      const listResult = await runGws({
        store,
        uid,
        // Re-use the inbox list tool's name so all message-list logs cluster.
        toolName: LIST_INBOX_TOOL_NAME,
        service: 'gmail',
        resource: 'users.messages',
        method: 'list',
        params: { userId: 'me', q: args.query, maxResults },
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

      const detailResults = await Promise.all(
        ids.map((id) =>
          runGws({
            store,
            uid,
            toolName: SEARCH_MESSAGES_TOOL_NAME,
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
      return { status: 'ok', messages };
    },
  });
}
