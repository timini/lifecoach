import type { TaskProjection } from '@lifecoach/shared-types';

/**
 * Project a raw `tasks.tasks.list` / `tasks.tasks.get` response into the
 * shape the LLM consumes. Drops fields the coach doesn't need
 * (`etag`, `selfLink`, `kind`, `updated`, `position`, `links`).
 */

export interface RawTask {
  id?: string;
  title?: string;
  due?: string;
  status?: string;
  notes?: string;
  completed?: string;
}

export function projectTask(raw: RawTask, taskListId: string): TaskProjection {
  const status: TaskProjection['status'] = raw.status === 'completed' ? 'completed' : 'needsAction';

  const projection: TaskProjection = {
    id: raw.id ?? '',
    taskListId,
    title: raw.title ?? '(untitled)',
    status,
  };
  if (raw.due) projection.due = raw.due;
  if (raw.notes) projection.notes = raw.notes;
  if (raw.completed) projection.completed = raw.completed;

  return projection;
}
