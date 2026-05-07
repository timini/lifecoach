import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceTokensStore } from '../../../storage/workspaceTokens.js';
import type { ExecFileLike } from '../gwsExec.js';
import { ADD_TASK_TOOL_NAME, type AddTaskResult, createAddTaskTool } from './addTask.js';

function fakeStore(): WorkspaceTokensStore {
  return {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(async () => undefined),
    getValidAccessToken: vi.fn(async () => 'ya29.fake'),
  };
}

function exec(tool: ReturnType<typeof createAddTaskTool>, input: unknown) {
  // biome-ignore lint/suspicious/noExplicitAny: ADK internals
  return (tool as any).execute(input) as Promise<AddTaskResult>;
}

describe('add_task', () => {
  it('has the expected name', () => {
    const tool = createAddTaskTool({ store: fakeStore(), uid: 'u' });
    expect(tool.name).toBe(ADD_TASK_TOOL_NAME);
  });

  it('builds tasks.insert with @default tasklist by default', async () => {
    const calls: string[][] = [];
    const fakeExec: ExecFileLike = async (_bin, argv) => {
      calls.push(argv);
      return {
        stdout: JSON.stringify({ id: 't1', title: 'Reply', status: 'needsAction' }),
        stderr: '',
        code: 0,
      };
    };
    const tool = createAddTaskTool({ store: fakeStore(), uid: 'u', execFile: fakeExec });
    const r = await exec(tool, { title: 'Reply to Maya' });
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.task.taskListId).toBe('@default');

    const argv = calls[0] ?? [];
    expect(argv.slice(0, 4)).toEqual(['tasks', 'tasks', 'insert', '--params']);
    const params = JSON.parse(argv[argv.indexOf('--params') + 1] ?? '{}');
    expect(params.tasklist).toBe('@default');
    const body = JSON.parse(argv[argv.indexOf('--json') + 1] ?? '{}');
    expect(body.title).toBe('Reply to Maya');
  });

  it('passes due + notes + custom taskListId through to the body', async () => {
    const calls: string[][] = [];
    const fakeExec: ExecFileLike = async (_bin, argv) => {
      calls.push(argv);
      return {
        stdout: JSON.stringify({ id: 't1', title: 'x', status: 'needsAction' }),
        stderr: '',
        code: 0,
      };
    };
    const tool = createAddTaskTool({ store: fakeStore(), uid: 'u', execFile: fakeExec });
    await exec(tool, {
      title: 'Pay invoice',
      due: '2026-05-08T00:00:00.000Z',
      notes: 'Invoice 2031',
      taskListId: 'work-list',
    });
    const params = JSON.parse(calls[0]?.[calls[0]?.indexOf('--params') + 1] ?? '{}');
    expect(params.tasklist).toBe('work-list');
    const body = JSON.parse(calls[0]?.[calls[0]?.indexOf('--json') + 1] ?? '{}');
    expect(body.due).toBe('2026-05-08T00:00:00.000Z');
    expect(body.notes).toBe('Invoice 2031');
  });

  it('propagates errors', async () => {
    const fakeExec: ExecFileLike = async () => ({
      stdout: JSON.stringify({ error: { code: 401, message: 'invalid_grant' } }),
      stderr: '',
      code: 1,
    });
    const tool = createAddTaskTool({ store: fakeStore(), uid: 'u', execFile: fakeExec });
    const r = await exec(tool, { title: 'x' });
    expect(r).toMatchObject({ status: 'error', code: 'scope_required' });
  });
});
