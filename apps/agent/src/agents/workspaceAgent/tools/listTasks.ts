import { FunctionTool } from '@google/adk';
import type { TaskProjection } from '@lifecoach/shared-types';
import { z } from 'zod';
import type { WorkspaceTokensStore } from '../../../storage/workspaceTokens.js';
import type { ExecFileLike } from '../gwsExec.js';
import { projectTask } from '../projections/task.js';
import { type RunGwsLogEvent, runGws } from '../runGws.js';

/**
 * `list_tasks` — Google Tasks list, filtered to needsAction by default.
 */

export const LIST_TASKS_TOOL_NAME = 'list_tasks';

export interface CreateListTasksToolDeps {
  store: WorkspaceTokensStore;
  uid: string;
  execFile?: ExecFileLike;
  log?: (event: RunGwsLogEvent) => void;
}

export type ListTasksResult =
  | { status: 'ok'; tasks: TaskProjection[]; truncated?: boolean }
  | { status: 'error'; code: string; message: string };

const parameters = z.object({
  taskListId: z.string().optional().describe('Task list id. Default "@default".'),
  showCompleted: z.boolean().optional().describe('Include completed tasks. Default false.'),
});

interface TasksListResponse {
  items?: unknown[];
}

export function createListTasksTool(deps: CreateListTasksToolDeps): FunctionTool {
  const { store, uid, execFile, log } = deps;

  // biome-ignore lint/suspicious/noExplicitAny: zod nominal mismatch with ADK generics
  return new FunctionTool<any>({
    name: LIST_TASKS_TOOL_NAME,
    description:
      'List Google Tasks in a task list. Returns projected task shapes (title, due, status, notes). Read-only.',
    parameters,
    execute: async (input: unknown): Promise<ListTasksResult> => {
      const args = input as { taskListId?: string; showCompleted?: boolean };
      const taskListId = args.taskListId ?? '@default';

      const result = await runGws({
        store,
        uid,
        toolName: LIST_TASKS_TOOL_NAME,
        service: 'tasks',
        resource: 'tasks',
        method: 'list',
        params: {
          tasklist: taskListId,
          showCompleted: args.showCompleted ?? false,
        },
        execFile,
        log,
      });
      if (result.status === 'error') {
        return { status: 'error', code: result.code, message: result.message };
      }
      const body = (result.body as TasksListResponse | null) ?? {};
      const tasks = (body.items ?? []).map((raw) =>
        // biome-ignore lint/suspicious/noExplicitAny: gws returns dynamic JSON
        projectTask(raw as any, taskListId),
      );
      return result.truncated ? { status: 'ok', tasks, truncated: true } : { status: 'ok', tasks };
    },
  });
}
