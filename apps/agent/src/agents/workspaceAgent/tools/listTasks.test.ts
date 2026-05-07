import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceTokensStore } from '../../../storage/workspaceTokens.js';
import type { ExecFileLike } from '../gwsExec.js';
import { LIST_TASKS_TOOL_NAME, type ListTasksResult, createListTasksTool } from './listTasks.js';

function fakeStore(): WorkspaceTokensStore {
  return {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(async () => undefined),
    getValidAccessToken: vi.fn(async () => 'ya29.fake'),
  };
}

function exec(tool: ReturnType<typeof createListTasksTool>, input: unknown) {
  // biome-ignore lint/suspicious/noExplicitAny: ADK internals
  return (tool as any).execute(input) as Promise<ListTasksResult>;
}

describe('list_tasks', () => {
  it('has the expected name', () => {
    const tool = createListTasksTool({ store: fakeStore(), uid: 'u' });
    expect(tool.name).toBe(LIST_TASKS_TOOL_NAME);
  });

  it('defaults to @default tasklist + showCompleted=false', async () => {
    const calls: string[][] = [];
    const fakeExec: ExecFileLike = async (_bin, argv) => {
      calls.push(argv);
      return { stdout: JSON.stringify({ items: [] }), stderr: '', code: 0 };
    };
    const tool = createListTasksTool({ store: fakeStore(), uid: 'u', execFile: fakeExec });
    await exec(tool, {});
    const params = JSON.parse(calls[0]?.[calls[0]?.indexOf('--params') + 1] ?? '{}');
    expect(params.tasklist).toBe('@default');
    expect(params.showCompleted).toBe(false);
  });

  it('projects each task through projectTask', async () => {
    const fakeExec: ExecFileLike = async () => ({
      stdout: JSON.stringify({
        items: [
          {
            id: 't1',
            title: 'Reply to Maya',
            status: 'needsAction',
            due: '2026-05-08T00:00:00.000Z',
            etag: 'junk',
            kind: 'tasks#task',
            position: '00000000000000000001',
          },
        ],
      }),
      stderr: '',
      code: 0,
    });
    const tool = createListTasksTool({ store: fakeStore(), uid: 'u', execFile: fakeExec });
    const r = await exec(tool, { taskListId: 'work-list' });
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.tasks).toHaveLength(1);
    expect(r.tasks[0]).toMatchObject({
      id: 't1',
      taskListId: 'work-list',
      title: 'Reply to Maya',
      status: 'needsAction',
      due: '2026-05-08T00:00:00.000Z',
    });
    expect(r.tasks[0]).not.toHaveProperty('etag');
    expect(r.tasks[0]).not.toHaveProperty('position');
  });

  it('passes showCompleted=true when requested', async () => {
    const calls: string[][] = [];
    const fakeExec: ExecFileLike = async (_bin, argv) => {
      calls.push(argv);
      return { stdout: JSON.stringify({ items: [] }), stderr: '', code: 0 };
    };
    const tool = createListTasksTool({ store: fakeStore(), uid: 'u', execFile: fakeExec });
    await exec(tool, { showCompleted: true });
    const params = JSON.parse(calls[0]?.[calls[0]?.indexOf('--params') + 1] ?? '{}');
    expect(params.showCompleted).toBe(true);
  });
});
