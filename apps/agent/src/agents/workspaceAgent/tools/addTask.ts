import { FunctionTool } from '@google/adk';
import type { TaskProjection } from '@lifecoach/shared-types';
import { z } from 'zod';
import type { WorkspaceTokensStore } from '../../../storage/workspaceTokens.js';
import type { ExecFileLike, GwsErrorCode } from '../gwsExec.js';
import { type RawTask, projectTask } from '../projections/task.js';
import { type RunGwsLogEvent, runGws } from '../runGws.js';

/**
 * `add_task` — single-step Google Tasks insert.
 */

export const ADD_TASK_TOOL_NAME = 'add_task';

export interface CreateAddTaskToolDeps {
  store: WorkspaceTokensStore;
  uid: string;
  execFile?: ExecFileLike;
  log?: (event: RunGwsLogEvent) => void;
}

export type AddTaskResult =
  | { status: 'ok'; task: TaskProjection }
  | { status: 'error'; code: GwsErrorCode; message: string };

const parameters = z.object({
  title: z.string().min(1).describe('Task title.'),
  due: z
    .string()
    .optional()
    .describe('Optional RFC3339 due date — Google Tasks treats this as a date-only value.'),
  notes: z.string().optional().describe('Optional task notes.'),
  taskListId: z.string().optional().describe('Task list id. Default "@default".'),
});

export function createAddTaskTool(deps: CreateAddTaskToolDeps): FunctionTool {
  const { store, uid, execFile, log } = deps;

  // biome-ignore lint/suspicious/noExplicitAny: zod nominal mismatch with ADK generics
  return new FunctionTool<any>({
    name: ADD_TASK_TOOL_NAME,
    description:
      "Add a task to the user's Google Tasks. Use after surfacing an action from triage_inbox or when the user explicitly asks to add a task. Returns the created task.",
    parameters,
    execute: async (input: unknown): Promise<AddTaskResult> => {
      const args = input as { title: string; due?: string; notes?: string; taskListId?: string };
      const taskListId = args.taskListId ?? '@default';

      const requestBody: Record<string, unknown> = { title: args.title };
      if (args.due) requestBody.due = args.due;
      if (args.notes) requestBody.notes = args.notes;

      const result = await runGws({
        store,
        uid,
        toolName: ADD_TASK_TOOL_NAME,
        service: 'tasks',
        resource: 'tasks',
        method: 'insert',
        params: { tasklist: taskListId },
        body: requestBody,
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
