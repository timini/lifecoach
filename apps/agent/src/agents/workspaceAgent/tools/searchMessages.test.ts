import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceTokensStore } from '../../../storage/workspaceTokens.js';
import type { ExecFileLike } from '../gwsExec.js';
import {
  SEARCH_MESSAGES_TOOL_NAME,
  type SearchMessagesResult,
  createSearchMessagesTool,
} from './searchMessages.js';

function fakeStore(): WorkspaceTokensStore {
  return {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(async () => undefined),
    getValidAccessToken: vi.fn(async () => 'ya29.fake'),
  };
}

function exec(tool: ReturnType<typeof createSearchMessagesTool>, input: unknown) {
  // biome-ignore lint/suspicious/noExplicitAny: ADK internals
  return (tool as any).execute(input) as Promise<SearchMessagesResult>;
}

describe('search_messages', () => {
  it('has the expected name', () => {
    const tool = createSearchMessagesTool({ store: fakeStore(), uid: 'u' });
    expect(tool.name).toBe(SEARCH_MESSAGES_TOOL_NAME);
  });

  it('passes the user query verbatim into Gmail q', async () => {
    const calls: string[][] = [];
    const fakeExec: ExecFileLike = async (_bin, argv) => {
      calls.push(argv);
      if (argv.includes('list')) {
        return { stdout: JSON.stringify({ messages: [] }), stderr: '', code: 0 };
      }
      return { stdout: '{}', stderr: '', code: 0 };
    };
    const tool = createSearchMessagesTool({ store: fakeStore(), uid: 'u', execFile: fakeExec });
    await exec(tool, { query: 'from:sarah newer_than:7d' });
    const params = JSON.parse(calls[0]?.[calls[0]?.indexOf('--params') + 1] ?? '{}');
    expect(params.q).toBe('from:sarah newer_than:7d');
    expect(params.maxResults).toBe(10);
  });

  it('uses a custom limit', async () => {
    const calls: string[][] = [];
    const fakeExec: ExecFileLike = async (_bin, argv) => {
      calls.push(argv);
      return { stdout: JSON.stringify({ messages: [] }), stderr: '', code: 0 };
    };
    const tool = createSearchMessagesTool({ store: fakeStore(), uid: 'u', execFile: fakeExec });
    await exec(tool, { query: 'from:x', limit: 25 });
    const params = JSON.parse(calls[0]?.[calls[0]?.indexOf('--params') + 1] ?? '{}');
    expect(params.maxResults).toBe(25);
  });

  it('returns metadata summaries on the happy path', async () => {
    const fakeExec: ExecFileLike = async (_bin, argv) => {
      if (argv.includes('list')) {
        return {
          stdout: JSON.stringify({ messages: [{ id: 'm1' }] }),
          stderr: '',
          code: 0,
        };
      }
      return {
        stdout: JSON.stringify({ id: 'm1', threadId: 't1', snippet: 'about lunch' }),
        stderr: '',
        code: 0,
      };
    };
    const tool = createSearchMessagesTool({ store: fakeStore(), uid: 'u', execFile: fakeExec });
    const r = await exec(tool, { query: 'lunch' });
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.messages).toEqual([{ id: 'm1', threadId: 't1', snippet: 'about lunch' }]);
  });
});
