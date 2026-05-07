import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceTokensStore } from '../../../storage/workspaceTokens.js';
import type { ExecFileLike } from '../gwsExec.js';
import {
  ARCHIVE_MESSAGES_TOOL_NAME,
  type ArchiveMessagesResult,
  createArchiveMessagesTool,
} from './archiveMessages.js';

function fakeStore(): WorkspaceTokensStore {
  return {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(async () => undefined),
    getValidAccessToken: vi.fn(async () => 'ya29.fake'),
  };
}

function exec(tool: ReturnType<typeof createArchiveMessagesTool>, input: unknown) {
  // biome-ignore lint/suspicious/noExplicitAny: ADK internals
  return (tool as any).execute(input) as Promise<ArchiveMessagesResult>;
}

describe('archive_messages', () => {
  it('has the expected name and description', () => {
    const tool = createArchiveMessagesTool({ store: fakeStore(), uid: 'u' });
    expect(tool.name).toBe(ARCHIVE_MESSAGES_TOOL_NAME);
    expect(tool.description.toLowerCase()).toContain('archive');
  });

  it('issues one modify call per id with removeLabelIds:["INBOX"]', async () => {
    const calls: string[][] = [];
    const fakeExec: ExecFileLike = async (_bin, argv) => {
      calls.push(argv);
      return { stdout: '{}', stderr: '', code: 0 };
    };
    const tool = createArchiveMessagesTool({ store: fakeStore(), uid: 'u', execFile: fakeExec });
    const r = await exec(tool, { ids: ['m1', 'm2', 'm3'] });
    expect(r).toEqual({ status: 'ok', archived: ['m1', 'm2', 'm3'], failed: [] });
    expect(calls).toHaveLength(3);
    for (const argv of calls) {
      expect(argv.slice(0, 4)).toEqual(['gmail', 'users', 'messages', 'modify']);
      expect(argv).toContain('--json');
      expect(argv[argv.indexOf('--json') + 1]).toBe(JSON.stringify({ removeLabelIds: ['INBOX'] }));
    }
  });

  it('reports per-id failures alongside successes', async () => {
    let i = 0;
    const fakeExec: ExecFileLike = async () => {
      i++;
      if (i === 2) {
        return {
          stdout: JSON.stringify({ error: { code: 404, message: 'not found' } }),
          stderr: '',
          code: 1,
        };
      }
      return { stdout: '{}', stderr: '', code: 0 };
    };
    const tool = createArchiveMessagesTool({ store: fakeStore(), uid: 'u', execFile: fakeExec });
    const r = await exec(tool, { ids: ['m1', 'm2', 'm3'] });
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.archived).toEqual(['m1', 'm3']);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0]).toMatchObject({ id: 'm2', code: 'not_found' });
  });

  it('returns top-level scope_required when every id fails with that code', async () => {
    const fakeExec: ExecFileLike = async () => ({
      stdout: JSON.stringify({ error: { code: 401, message: 'invalid_grant' } }),
      stderr: '',
      code: 1,
    });
    const tool = createArchiveMessagesTool({ store: fakeStore(), uid: 'u', execFile: fakeExec });
    const r = await exec(tool, { ids: ['m1', 'm2'] });
    expect(r).toMatchObject({ status: 'error', code: 'scope_required' });
  });
});
