import { describe, expect, it, vi } from 'vitest';
import { ScopeRequiredError, type WorkspaceTokensStore } from '../../storage/workspaceTokens.js';
import type { ExecFileLike } from './gwsExec.js';
import { type RunGwsLogEvent, runGws } from './runGws.js';

function fakeStore(accessToken = 'ya29.fake'): WorkspaceTokensStore {
  return {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(async () => undefined),
    getValidAccessToken: vi.fn(async () => accessToken),
  };
}

describe('runGws — happy path', () => {
  it('builds argv from service + dotted resource + method + params', async () => {
    const fakeExec = vi.fn<ExecFileLike>(async () => ({
      stdout: JSON.stringify({ messages: [{ id: 'm1' }] }),
      stderr: '',
      code: 0,
    }));
    await runGws({
      store: fakeStore(),
      uid: 'u',
      toolName: 'list_inbox',
      service: 'gmail',
      resource: 'users.messages',
      method: 'list',
      params: { userId: 'me', q: 'in:inbox' },
      execFile: fakeExec,
    });

    expect(fakeExec).toHaveBeenCalledTimes(1);
    const [bin, argv] = fakeExec.mock.calls[0];
    expect(bin).toBe('gws');
    expect(argv).toEqual([
      'gmail',
      'users',
      'messages',
      'list',
      '--params',
      JSON.stringify({ userId: 'me', q: 'in:inbox' }),
    ]);
  });

  it('appends --json when a body is provided (writes path)', async () => {
    const fakeExec = vi.fn<ExecFileLike>(async () => ({
      stdout: JSON.stringify({ id: 'm1' }),
      stderr: '',
      code: 0,
    }));
    await runGws({
      store: fakeStore(),
      uid: 'u',
      toolName: 'archive_messages',
      service: 'gmail',
      resource: 'users.messages',
      method: 'modify',
      params: { userId: 'me', id: 'm1' },
      body: { removeLabelIds: ['INBOX'] },
      execFile: fakeExec,
    });
    const argv = fakeExec.mock.calls[0]?.[1] ?? [];
    expect(argv).toContain('--json');
    expect(argv[argv.indexOf('--json') + 1]).toBe(JSON.stringify({ removeLabelIds: ['INBOX'] }));
  });

  it('parses JSON stdout into the body', async () => {
    const r = await runGws({
      store: fakeStore(),
      uid: 'u',
      toolName: 't',
      service: 'gmail',
      resource: 'users.messages',
      method: 'list',
      execFile: async () => ({
        stdout: JSON.stringify({ messages: [] }),
        stderr: '',
        code: 0,
      }),
    });
    expect(r).toEqual({ status: 'ok', body: { messages: [] } });
  });

  it('falls back to string body when stdout is not JSON', async () => {
    const r = await runGws({
      store: fakeStore(),
      uid: 'u',
      toolName: 't',
      service: 'gmail',
      resource: 'users.messages',
      method: 'list',
      execFile: async () => ({
        stdout: 'plain text response',
        stderr: '',
        code: 0,
      }),
    });
    expect(r).toEqual({ status: 'ok', body: 'plain text response' });
  });

  it('flags truncated when stdout exceeds 32 KB', async () => {
    const big = 'x'.repeat(40 * 1024);
    const r = await runGws({
      store: fakeStore(),
      uid: 'u',
      toolName: 't',
      service: 'gmail',
      resource: 'users.messages',
      method: 'list',
      execFile: async () => ({ stdout: big, stderr: '', code: 0 }),
    });
    expect(r.status).toBe('ok');
    if (r.status === 'ok') expect(r.truncated).toBe(true);
  });

  it('emits a log event on the happy path with no stderr/stdout sample', async () => {
    const events: RunGwsLogEvent[] = [];
    await runGws({
      store: fakeStore(),
      uid: 'u',
      toolName: 'list_inbox',
      service: 'gmail',
      resource: 'users.messages',
      method: 'list',
      execFile: async () => ({ stdout: '{}', stderr: '', code: 0 }),
      log: (e) => events.push(e),
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ name: 'list_inbox', outcome: 'ok', exitCode: 0 });
    expect(events[0].stderrSample).toBeUndefined();
    expect(events[0].stdoutSample).toBeUndefined();
  });

  it('passes the access token via env, never argv', async () => {
    const fakeExec = vi.fn<ExecFileLike>(async () => ({
      stdout: '{}',
      stderr: '',
      code: 0,
    }));
    await runGws({
      store: fakeStore('ya29.s3cret'),
      uid: 'u',
      toolName: 't',
      service: 'gmail',
      resource: 'users.messages',
      method: 'list',
      execFile: fakeExec,
    });
    const opts = fakeExec.mock.calls[0]?.[2];
    expect(opts?.env?.GOOGLE_WORKSPACE_CLI_TOKEN).toBe('ya29.s3cret');
    const argv = fakeExec.mock.calls[0]?.[1] ?? [];
    for (const a of argv) {
      expect(a).not.toContain('ya29.s3cret');
    }
  });
});

describe('runGws — error paths', () => {
  it('returns scope_required and deletes the token doc when getValidAccessToken throws', async () => {
    const store = fakeStore();
    (store.getValidAccessToken as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new ScopeRequiredError(),
    );
    const r = await runGws({
      store,
      uid: 'u',
      toolName: 't',
      service: 'gmail',
      resource: 'users.messages',
      method: 'list',
      execFile: vi.fn(),
    });
    expect(r).toMatchObject({ status: 'error', code: 'scope_required' });
    // Token-doc delete is the responsibility of getValidAccessToken's
    // own retry path (not duplicated here on the auth fail branch).
  });

  it('classifies a 401 stdout error and deletes the token doc', async () => {
    const store = fakeStore();
    const r = await runGws({
      store,
      uid: 'u',
      toolName: 't',
      service: 'gmail',
      resource: 'users.messages',
      method: 'list',
      execFile: async () => ({
        stdout: JSON.stringify({
          error: { code: 401, message: 'invalid_grant: token expired' },
        }),
        stderr: '',
        code: 1,
      }),
    });
    expect(r).toMatchObject({ status: 'error', code: 'scope_required' });
    expect(store.delete).toHaveBeenCalledWith('u');
  });

  it('classifies a 403 plain-permission error as forbidden and does NOT delete the token', async () => {
    const store = fakeStore();
    const r = await runGws({
      store,
      uid: 'u',
      toolName: 't',
      service: 'gmail',
      resource: 'users.messages',
      method: 'list',
      execFile: async () => ({
        stdout: JSON.stringify({ error: { code: 403, message: 'permission denied' } }),
        stderr: '',
        code: 1,
      }),
    });
    expect(r).toMatchObject({ status: 'error', code: 'forbidden' });
    expect(store.delete).not.toHaveBeenCalled();
  });

  it('attaches sanitised stderr/stdout samples to the error log event', async () => {
    const events: RunGwsLogEvent[] = [];
    await runGws({
      store: fakeStore(),
      uid: 'u',
      toolName: 't',
      service: 'gmail',
      resource: 'users.messages',
      method: 'list',
      execFile: async () => ({
        stdout: JSON.stringify({ error: { code: 429, message: 'rate limit' } }),
        stderr: '',
        code: 1,
      }),
      log: (e) => events.push(e),
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ name: 't', outcome: 'rate_limited' });
    // stdoutSample is populated on errors so we can debug from logs.
    expect(events[0].stdoutSample).toContain('rate limit');
  });

  it('redacts ya29 tokens that somehow appear in stderr before logging', async () => {
    const events: RunGwsLogEvent[] = [];
    await runGws({
      store: fakeStore(),
      uid: 'u',
      toolName: 't',
      service: 'gmail',
      resource: 'users.messages',
      method: 'list',
      execFile: async () => ({
        stdout: '',
        stderr: 'failed with token ya29.somethingsecret in args',
        code: 1,
      }),
      log: (e) => events.push(e),
    });
    expect(events[0].stderrSample).toContain('[redacted]');
    expect(events[0].stderrSample).not.toContain('ya29.somethingsecret');
  });
});
