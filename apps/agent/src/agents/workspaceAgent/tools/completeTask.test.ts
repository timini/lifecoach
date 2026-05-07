import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceTokensStore } from '../../../storage/workspaceTokens.js';
import type { ExecFileLike } from '../gwsExec.js';
import {
  COMPLETE_TASK_TOOL_NAME,
  type CompleteTaskResult,
  createCompleteTaskTool,
} from './completeTask.js';

function fakeStore(): WorkspaceTokensStore {
  return {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(async () => undefined),
    getValidAccessToken: vi.fn(async () => 'ya29.fake'),
  };
}

function exec(tool: ReturnType<typeof createCompleteTaskTool>, input: unknown) {
  // biome-ignore lint/suspicious/noExplicitAny: ADK internals
  return (tool as any).execute(input) as Promise<CompleteTaskResult>;
}

describe('complete_task', () => {
  it('has the expected name', () => {
    const tool = createCompleteTaskTool({ store: fakeStore(), uid: 'u' });
    expect(tool.name).toBe(COMPLETE_TASK_TOOL_NAME);
  });

  it('builds tasks.update with status=completed and the task id', async () => {
    const calls: string[][] = [];
    const fakeExec: ExecFileLike = async (_bin, argv) => {
      calls.push(argv);
      return {
        stdout: JSON.stringify({
          id: 't1',
          title: 'Pay invoice',
          status: 'completed',
          completed: '2026-05-07T11:00:00.000Z',
        }),
        stderr: '',
        code: 0,
      };
    };
    const tool = createCompleteTaskTool({ store: fakeStore(), uid: 'u', execFile: fakeExec });
    const r = await exec(tool, { id: 't1' });
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.task.status).toBe('completed');

    const argv = calls[0] ?? [];
    // Use patch (PATCH partial), NOT update (PUT full resource), so
    // title/notes/due aren't wiped.
    expect(argv.slice(0, 4)).toEqual(['tasks', 'tasks', 'patch', '--params']);
    const params = JSON.parse(argv[argv.indexOf('--params') + 1] ?? '{}');
    expect(params.task).toBe('t1');
    const body = JSON.parse(argv[argv.indexOf('--json') + 1] ?? '{}');
    expect(body.status).toBe('completed');
    // patch body should NOT include the id (avoids accidental clobber).
    expect(body.id).toBeUndefined();
  });

  it('honours a custom taskListId', async () => {
    const calls: string[][] = [];
    const fakeExec: ExecFileLike = async (_bin, argv) => {
      calls.push(argv);
      return {
        stdout: JSON.stringify({ id: 't1', title: 'x', status: 'completed' }),
        stderr: '',
        code: 0,
      };
    };
    const tool = createCompleteTaskTool({ store: fakeStore(), uid: 'u', execFile: fakeExec });
    await exec(tool, { id: 't1', taskListId: 'work-list' });
    const params = JSON.parse(calls[0]?.[calls[0]?.indexOf('--params') + 1] ?? '{}');
    expect(params.tasklist).toBe('work-list');
  });

  it('propagates 404 when the task id does not exist', async () => {
    const fakeExec: ExecFileLike = async () => ({
      stdout: JSON.stringify({ error: { code: 404, message: 'not found' } }),
      stderr: '',
      code: 1,
    });
    const tool = createCompleteTaskTool({ store: fakeStore(), uid: 'u', execFile: fakeExec });
    const r = await exec(tool, { id: 'nope' });
    expect(r).toMatchObject({ status: 'error', code: 'not_found' });
  });
});
