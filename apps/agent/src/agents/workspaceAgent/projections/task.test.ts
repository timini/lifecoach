import { TaskProjectionSchema } from '@lifecoach/shared-types';
import { describe, expect, it } from 'vitest';
import { projectTask } from './task.js';

describe('projectTask', () => {
  it('projects a needsAction task', () => {
    const projection = projectTask(
      {
        id: 't1',
        title: 'Reply to Maya',
        status: 'needsAction',
        due: '2026-05-08T00:00:00.000Z',
        notes: 'About the parents evening',
      },
      '@default',
    );
    expect(projection).toEqual({
      id: 't1',
      taskListId: '@default',
      title: 'Reply to Maya',
      status: 'needsAction',
      due: '2026-05-08T00:00:00.000Z',
      notes: 'About the parents evening',
    });
    expect(TaskProjectionSchema.parse(projection)).toEqual(projection);
  });

  it('projects a completed task with completion timestamp', () => {
    const projection = projectTask(
      {
        id: 't1',
        title: 'Pay invoice',
        status: 'completed',
        completed: '2026-05-07T11:00:00.000Z',
      },
      '@default',
    );
    expect(projection.status).toBe('completed');
    expect(projection.completed).toBe('2026-05-07T11:00:00.000Z');
  });

  it('coerces unknown statuses to needsAction', () => {
    const projection = projectTask({ id: 't1', title: 'x', status: 'in_progress' }, '@default');
    expect(projection.status).toBe('needsAction');
  });

  it('falls back to "(untitled)" when title missing', () => {
    const projection = projectTask({ id: 't1' }, '@default');
    expect(projection.title).toBe('(untitled)');
  });

  it('omits optional fields when absent', () => {
    const projection = projectTask({ id: 't1', title: 'x', status: 'needsAction' }, 'list-2');
    expect(projection.due).toBeUndefined();
    expect(projection.notes).toBeUndefined();
    expect(projection.completed).toBeUndefined();
  });

  it('threads the taskListId through unchanged', () => {
    const projection = projectTask({ id: 't1', title: 'x', status: 'needsAction' }, 'work-list');
    expect(projection.taskListId).toBe('work-list');
  });
});
