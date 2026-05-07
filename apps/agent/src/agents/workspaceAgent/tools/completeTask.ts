import { FunctionTool } from '@google/adk';
import type { TaskProjection } from '@lifecoach/shared-types';
import { z } from 'zod';
import type { WorkspaceTokensStore } from '../../../storage/workspaceTokens.js';
import type { ExecFileLike, GwsErrorCode } from '../gwsExec.js';
import { type RawTask, projectTask } from '../projections/task.js';
import { type RunGwsLogEvent, runGws } from '../runGws.js';

/**
 * `complete_task` — mark a Google Task as completed.
 */

export const COMPLETE_TASK_TOOL_NAME = 'complete_task';

export interface CreateCompleteTaskToolDeps {
  store: WorkspaceTokensStore;
  uid: string;
  execFile?: ExecFileLike;
  log?: (event: RunGwsLogEvent) => void;
}

export type CompleteTaskResult =
  | { status: 'ok'; task: TaskProjection }
  | { status: 'error'; code: GwsErrorCode; message: string };

const parameters = z.object({
  id: z.string().min(1).describe('Task id (from list_tasks).'),
  taskListId: z.string().optional().describe('Task list id. Default "@default".'),
});

export function createCompleteTaskTool(deps: CreateCompleteTaskToolDeps): FunctionTool {
  const { store, uid, execFile, log } = deps;

  // biome-ignore lint/suspicious/noExplicitAny: zod nominal mismatch with ADK generics
  return new FunctionTool<any>({
    name: COMPLETE_TASK_TOOL_NAME,
    description:
      'Mark a Google Task as completed. Use when the user says they finished an item from list_tasks or a triage action.',
    parameters,
    execute: async (input: unknown): Promise<CompleteTaskResult> => {
      const args = input as { id: string; taskListId?: string };
      const taskListId = args.taskListId ?? '@default';

      // tasks.update is a PUT requiring the FULL task resource — sending
      // only `{id, status}` would wipe title/notes/due. tasks.patch is
      // the partial-update endpoint and is the correct verb for a
      // single-field flip.
      const result = await runGws({
        store,
        uid,
        toolName: COMPLETE_TASK_TOOL_NAME,
        service: 'tasks',
        resource: 'tasks',
        method: 'patch',
        params: { tasklist: taskListId, task: args.id },
        body: { status: 'completed' },
        execFile,
        log,
      });
      if (result.status === 'error') {
        return { status: 'error', code: result.code, message: result.message };
      }
      const projection = projectTask(
        ((result.body as RawTask | null) ?? {}) as RawTask,
        taskListId,
      );
      return { status: 'ok', task: projection };
    },
  });
}
