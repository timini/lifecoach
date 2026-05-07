import { FunctionTool } from '@google/adk';
import type { MessageProjection } from '@lifecoach/shared-types';
import { z } from 'zod';
import type { WorkspaceTokensStore } from '../../../storage/workspaceTokens.js';
import type { ExecFileLike } from '../gwsExec.js';
import { projectGmailMessage } from '../projections/gmailMessage.js';
import { type RunGwsLogEvent, runGws } from '../runGws.js';

/**
 * `get_message` — fetch a Gmail message and return the projection (decoded
 * body, allow-listed headers, 4 KB cap). The base64-decode happens inside
 * `projectGmailMessage`, never on the LLM side.
 */

export const GET_MESSAGE_TOOL_NAME = 'get_message';

export interface CreateGetMessageToolDeps {
  store: WorkspaceTokensStore;
  uid: string;
  execFile?: ExecFileLike;
  log?: (event: RunGwsLogEvent) => void;
}

export type GetMessageResult =
  | { status: 'ok'; message: MessageProjection }
  | { status: 'error'; code: string; message: string };

const parameters = z.object({
  id: z.string().min(1).describe('Gmail message id (from list_inbox or search_messages).'),
  format: z
    .enum(['full', 'metadata'])
    .optional()
    .describe('"full" includes the body (decoded text); "metadata" omits it. Default "full".'),
});

export function createGetMessageTool(deps: CreateGetMessageToolDeps): FunctionTool {
  const { store, uid, execFile, log } = deps;

  // biome-ignore lint/suspicious/noExplicitAny: zod nominal mismatch with ADK generics
  return new FunctionTool<any>({
    name: GET_MESSAGE_TOOL_NAME,
    description:
      'Fetch a single Gmail message by id and return the projected shape (decoded body, allow-listed headers). Read-only.',
    parameters,
    execute: async (input: unknown): Promise<GetMessageResult> => {
      const args = input as { id: string; format?: 'full' | 'metadata' };
      const result = await runGws({
        store,
        uid,
        toolName: GET_MESSAGE_TOOL_NAME,
        service: 'gmail',
        resource: 'users.messages',
        method: 'get',
        params: { userId: 'me', id: args.id, format: args.format ?? 'full' },
        execFile,
        log,
      });
      if (result.status === 'error') {
        return { status: 'error', code: result.code, message: result.message };
      }
      const projection = projectGmailMessage(
        // biome-ignore lint/suspicious/noExplicitAny: gws returns dynamic JSON
        (result.body ?? {}) as any,
      );
      return { status: 'ok', message: projection };
    },
  });
}
