import { FunctionTool } from '@google/adk';
import { z } from 'zod';
import type { WorkspaceTokensStore } from '../../../storage/workspaceTokens.js';
import type { ExecFileLike, GwsErrorCode } from '../gwsExec.js';
import { type RunGwsLogEvent, runGws } from '../runGws.js';

/**
 * `archive_messages` — remove the INBOX label from one or more Gmail
 * messages. Idempotent (Gmail accepts modify on already-archived
 * messages).
 *
 * Single-step write: the LLM picks ids from a triage_inbox report (or
 * find_workspace) and passes them in one batched call. We loop server-
 * side rather than expecting N tool calls — each id is a separate gws
 * invocation, but only one tool-call from the LLM's perspective.
 */

export const ARCHIVE_MESSAGES_TOOL_NAME = 'archive_messages';

export interface CreateArchiveMessagesToolDeps {
  store: WorkspaceTokensStore;
  uid: string;
  execFile?: ExecFileLike;
  log?: (event: RunGwsLogEvent) => void;
}

export interface ArchiveFailure {
  id: string;
  code: GwsErrorCode;
  message: string;
}

export type ArchiveMessagesResult =
  | { status: 'ok'; archived: string[]; failed: ArchiveFailure[] }
  | { status: 'error'; code: GwsErrorCode; message: string };

const parameters = z.object({
  ids: z
    .array(z.string().min(1))
    .min(1)
    .describe(
      'Gmail message ids to archive. Use the ids from a triage_inbox report or from find_workspace. Pass them all at once — the tool batches them server-side.',
    ),
});

export function createArchiveMessagesTool(deps: CreateArchiveMessagesToolDeps): FunctionTool {
  const { store, uid, execFile, log } = deps;

  // biome-ignore lint/suspicious/noExplicitAny: zod nominal mismatch with ADK generics
  return new FunctionTool<any>({
    name: ARCHIVE_MESSAGES_TOOL_NAME,
    description:
      'Archive Gmail messages by removing the INBOX label. Idempotent. Returns archived[] and failed[] arrays. Use after the user confirms via ask_single_choice_question.',
    parameters,
    execute: async (input: unknown): Promise<ArchiveMessagesResult> => {
      const args = input as { ids: string[] };

      const results = await Promise.all(
        args.ids.map((id) =>
          runGws({
            store,
            uid,
            toolName: ARCHIVE_MESSAGES_TOOL_NAME,
            service: 'gmail',
            resource: 'users.messages',
            method: 'modify',
            params: { userId: 'me', id },
            body: { removeLabelIds: ['INBOX'] },
            execFile,
            log,
          }).then((r) => ({ id, result: r })),
        ),
      );

      const archived: string[] = [];
      const failed: ArchiveFailure[] = [];
      for (const { id, result } of results) {
        if (result.status === 'ok') {
          archived.push(id);
        } else {
          failed.push({ id, code: result.code, message: result.message });
        }
      }

      // If every single one failed with an auth error, surface as a
      // top-level error so the LLM can react (call connect_workspace).
      const firstFailure = failed[0];
      if (archived.length === 0 && firstFailure?.code === 'scope_required') {
        return { status: 'error', code: 'scope_required', message: firstFailure.message };
      }
      return { status: 'ok', archived, failed };
    },
  });
}
