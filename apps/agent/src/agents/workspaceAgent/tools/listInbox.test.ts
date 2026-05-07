import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceTokensStore } from '../../../storage/workspaceTokens.js';
import type { ExecFileLike } from '../gwsExec.js';
import { LIST_INBOX_TOOL_NAME, type ListInboxResult, createListInboxTool } from './listInbox.js';

function fakeStore(): WorkspaceTokensStore {
  return {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(async () => undefined),
    getValidAccessToken: vi.fn(async () => 'ya29.fake'),
  };
}

function exec(tool: ReturnType<typeof createListInboxTool>, input: unknown) {
  // biome-ignore lint/suspicious/noExplicitAny: ADK internals
  return (tool as any).execute(input) as Promise<ListInboxResult>;
}

describe('list_inbox', () => {
  it('has the expected name and description', () => {
    const tool = createListInboxTool({ store: fakeStore(), uid: 'u' });
    expect(tool.name).toBe(LIST_INBOX_TOOL_NAME);
    expect(tool.description.toLowerCase()).toContain('read-only');
  });

  it('builds a Gmail query with sensible defaults (label:INBOX + newer_than:1d)', async () => {
    const calls: string[][] = [];
    const fakeExec: ExecFileLike = async (_bin, argv) => {
      calls.push(argv);
      // First call is messages.list — return one id.
      if (argv.includes('list')) {
        return { stdout: JSON.stringify({ messages: [{ id: 'm1' }] }), stderr: '', code: 0 };
      }
      // Subsequent calls are messages.get (metadata) — return metadata.
      return {
        stdout: JSON.stringify({ id: 'm1', threadId: 't1', snippet: 'hi' }),
        stderr: '',
        code: 0,
      };
    };
    const tool = createListInboxTool({ store: fakeStore(), uid: 'u', execFile: fakeExec });
    const r = await exec(tool, {});
    expect(r).toMatchObject({
      status: 'ok',
      messages: [{ id: 'm1', threadId: 't1', snippet: 'hi' }],
    });

    const listArgv = calls.find((a) => a.includes('list'));
    const params = JSON.parse(listArgv?.[listArgv.indexOf('--params') + 1] ?? '{}');
    expect(params.q).toBe('label:INBOX newer_than:1d');
    expect(params.maxResults).toBe(15);
  });

  it('respects unreadOnly + custom since + limit', async () => {
    const calls: string[][] = [];
    const fakeExec: ExecFileLike = async (_bin, argv) => {
      calls.push(argv);
      if (argv.includes('list')) {
        return { stdout: JSON.stringify({ messages: [] }), stderr: '', code: 0 };
      }
      return { stdout: '{}', stderr: '', code: 0 };
    };
    const tool = createListInboxTool({ store: fakeStore(), uid: 'u', execFile: fakeExec });
    await exec(tool, { unreadOnly: true, since: '7d', limit: 5 });

    const params = JSON.parse(calls[0]?.[calls[0]?.indexOf('--params') + 1] ?? '{}');
    expect(params.q).toBe('is:unread label:INBOX newer_than:7d');
    expect(params.maxResults).toBe(5);
  });

  it('returns an empty list (no get_message fan-out) when list returns no ids', async () => {
    let listCalls = 0;
    let getCalls = 0;
    const fakeExec: ExecFileLike = async (_bin, argv) => {
      if (argv.includes('list')) {
        listCalls++;
        return { stdout: JSON.stringify({ messages: [] }), stderr: '', code: 0 };
      }
      getCalls++;
      return { stdout: '{}', stderr: '', code: 0 };
    };
    const tool = createListInboxTool({ store: fakeStore(), uid: 'u', execFile: fakeExec });
    const r = await exec(tool, {});
    expect(r).toEqual({ status: 'ok', messages: [] });
    expect(listCalls).toBe(1);
    expect(getCalls).toBe(0);
  });

  it('propagates list errors directly (no fan-out)', async () => {
    const fakeExec: ExecFileLike = async () => ({
      stdout: JSON.stringify({ error: { code: 401, message: 'invalid_grant' } }),
      stderr: '',
      code: 1,
    });
    const tool = createListInboxTool({ store: fakeStore(), uid: 'u', execFile: fakeExec });
    const r = await exec(tool, {});
    expect(r).toMatchObject({ status: 'error', code: 'scope_required' });
  });

  it('skips messages whose detail get failed', async () => {
    let i = 0;
    const fakeExec: ExecFileLike = async (_bin, argv) => {
      if (argv.includes('list')) {
        return {
          stdout: JSON.stringify({ messages: [{ id: 'm1' }, { id: 'm2' }] }),
          stderr: '',
          code: 0,
        };
      }
      i++;
      if (i === 1) {
        return {
          stdout: JSON.stringify({ id: 'm1', threadId: 't1', snippet: 'first' }),
          stderr: '',
          code: 0,
        };
      }
      return {
        stdout: JSON.stringify({ error: { code: 404, message: 'not found' } }),
        stderr: '',
        code: 1,
      };
    };
    const tool = createListInboxTool({ store: fakeStore(), uid: 'u', execFile: fakeExec });
    const r = await exec(tool, {});
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.messages).toEqual([{ id: 'm1', threadId: 't1', snippet: 'first' }]);
  });
});
