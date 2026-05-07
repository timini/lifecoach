import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceTokensStore } from '../../../storage/workspaceTokens.js';
import type { ExecFileLike } from '../gwsExec.js';
import {
  GET_MESSAGE_TOOL_NAME,
  type GetMessageResult,
  createGetMessageTool,
} from './getMessage.js';

const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64url');

function fakeStore(): WorkspaceTokensStore {
  return {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(async () => undefined),
    getValidAccessToken: vi.fn(async () => 'ya29.fake'),
  };
}

function exec(tool: ReturnType<typeof createGetMessageTool>, input: unknown) {
  // biome-ignore lint/suspicious/noExplicitAny: ADK internals
  return (tool as any).execute(input) as Promise<GetMessageResult>;
}

describe('get_message', () => {
  it('has the expected name and description', () => {
    const tool = createGetMessageTool({ store: fakeStore(), uid: 'u' });
    expect(tool.name).toBe(GET_MESSAGE_TOOL_NAME);
    expect(tool.description.toLowerCase()).toContain('decoded body');
  });

  it('decodes the body via projectGmailMessage on the happy path', async () => {
    const fakeExec: ExecFileLike = async () => ({
      stdout: JSON.stringify({
        id: 'm1',
        threadId: 't1',
        snippet: 'hi…',
        payload: {
          mimeType: 'text/plain',
          headers: [
            { name: 'From', value: 'a@b' },
            { name: 'Subject', value: 'Lunch?' },
            { name: 'Date', value: 'Mon, 06 May 2026 09:12:00 +0100' },
          ],
          body: { data: b64url('Are you free for lunch?') },
        },
      }),
      stderr: '',
      code: 0,
    });
    const tool = createGetMessageTool({ store: fakeStore(), uid: 'u', execFile: fakeExec });
    const r = await exec(tool, { id: 'm1' });
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.message.body).toBe('Are you free for lunch?');
    expect(r.message.subject).toBe('Lunch?');
    expect(r.message.from).toBe('a@b');
  });

  it('builds the gws argv with format=full by default', async () => {
    const calls: string[][] = [];
    const fakeExec: ExecFileLike = async (_bin, argv) => {
      calls.push(argv);
      return { stdout: JSON.stringify({ id: 'm1' }), stderr: '', code: 0 };
    };
    const tool = createGetMessageTool({ store: fakeStore(), uid: 'u', execFile: fakeExec });
    await exec(tool, { id: 'm1' });
    const params = JSON.parse(calls[0]?.[calls[0]?.indexOf('--params') + 1] ?? '{}');
    expect(params.format).toBe('full');
    expect(params.id).toBe('m1');
    expect(params.userId).toBe('me');
  });

  it('passes format=metadata through when requested', async () => {
    const calls: string[][] = [];
    const fakeExec: ExecFileLike = async (_bin, argv) => {
      calls.push(argv);
      return { stdout: JSON.stringify({ id: 'm1' }), stderr: '', code: 0 };
    };
    const tool = createGetMessageTool({ store: fakeStore(), uid: 'u', execFile: fakeExec });
    await exec(tool, { id: 'm1', format: 'metadata' });
    const params = JSON.parse(calls[0]?.[calls[0]?.indexOf('--params') + 1] ?? '{}');
    expect(params.format).toBe('metadata');
  });

  it('propagates structured errors from runGws', async () => {
    const fakeExec: ExecFileLike = async () => ({
      stdout: JSON.stringify({ error: { code: 404, message: 'not found' } }),
      stderr: '',
      code: 1,
    });
    const tool = createGetMessageTool({ store: fakeStore(), uid: 'u', execFile: fakeExec });
    const r = await exec(tool, { id: 'doesnotexist' });
    expect(r).toMatchObject({ status: 'error', code: 'not_found' });
  });
});
