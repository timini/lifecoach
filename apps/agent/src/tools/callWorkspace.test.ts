import { describe, expect, it, vi } from 'vitest';
import { ScopeRequiredError, type WorkspaceTokensStore } from '../storage/workspaceTokens.js';
import {
  CALL_WORKSPACE_TOOL_NAME,
  type CallWorkspaceResult,
  type ExecFileLike,
  MAX_STDOUT_BYTES,
  classifyError,
  createCallWorkspaceTool,
} from './callWorkspace.js';

function fakeStore(accessToken = 'ya29.fake'): WorkspaceTokensStore {
  return {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(async () => undefined),
    getValidAccessToken: vi.fn(async () => accessToken),
  };
}

function exec(tool: ReturnType<typeof createCallWorkspaceTool>, input: unknown) {
  // biome-ignore lint/suspicious/noExplicitAny: ADK internals
  return (tool as any).execute(input) as Promise<CallWorkspaceResult>;
}

describe('call_workspace — metadata', () => {
  it('has the expected name and forbids direct token handling', () => {
    const tool = createCallWorkspaceTool({
      store: fakeStore(),
      uid: 'u',
      execFile: vi.fn(),
    });
    expect(tool.name).toBe(CALL_WORKSPACE_TOOL_NAME);
    expect(tool.description.toLowerCase()).toContain('do not attempt to pass tokens');
  });
});

describe('call_workspace — happy path', () => {
  it('spawns gws with argv only (no shell) and parses JSON stdout', async () => {
    const fakeExec = vi.fn<ExecFileLike>(async () => ({
      stdout: JSON.stringify({ messages: [{ id: 'abc' }] }),
      stderr: '',
      code: 0,
    }));
    const tool = createCallWorkspaceTool({
      store: fakeStore('ya29.valid'),
      uid: 'u-1',
      execFile: fakeExec,
    });
    const r = await exec(tool, {
      service: 'gmail',
      resource: 'messages',
      method: 'list',
      params: JSON.stringify({ q: 'from:alex', maxResults: 5 }),
    });

    expect(r).toEqual({ status: 'ok', body: { messages: [{ id: 'abc' }] } });
    expect(fakeExec).toHaveBeenCalledTimes(1);

    const [cmd, argv, opts] = fakeExec.mock.calls[0] as [
      string,
      string[],
      { env: NodeJS.ProcessEnv },
    ];
    expect(cmd).toBe('gws');
    // argv is structured, not a shell string.
    expect(argv[0]).toBe('gmail');
    expect(argv[1]).toBe('messages');
    expect(argv[2]).toBe('list');
    expect(argv[3]).toBe('--params');
    expect(JSON.parse(argv[4] as string)).toEqual({ q: 'from:alex', maxResults: 5 });
    expect(argv).toContain('--json');
    // Token reaches the child via env, not argv.
    expect(opts.env.GOOGLE_WORKSPACE_CLI_TOKEN).toBe('ya29.valid');
    for (const piece of argv) {
      expect(piece).not.toContain('ya29.valid');
    }
  });

  it('returns the raw stdout when it is not JSON', async () => {
    const fakeExec = vi.fn<ExecFileLike>(async () => ({
      stdout: 'ok',
      stderr: '',
      code: 0,
    }));
    const tool = createCallWorkspaceTool({
      store: fakeStore(),
      uid: 'u',
      execFile: fakeExec,
    });
    const r = await exec(tool, { service: 'tasks', resource: 'tasks', method: 'list' });
    expect(r).toEqual({ status: 'ok', body: 'ok' });
  });

  it('truncates stdout over MAX_STDOUT_BYTES and flags truncated:true', async () => {
    const big = 'x'.repeat(MAX_STDOUT_BYTES + 1000);
    const fakeExec = vi.fn<ExecFileLike>(async () => ({
      stdout: big,
      stderr: '',
      code: 0,
    }));
    const tool = createCallWorkspaceTool({
      store: fakeStore(),
      uid: 'u',
      execFile: fakeExec,
    });
    const r = await exec(tool, { service: 'gmail', resource: 'messages', method: 'list' });
    expect(r.status).toBe('ok');
    if (r.status === 'ok') {
      expect(r.truncated).toBe(true);
      // body stays as a string when parse fails, and is at most MAX.
      expect(typeof r.body === 'string' ? r.body.length : -1).toBeLessThanOrEqual(MAX_STDOUT_BYTES);
    }
  });
});

describe('call_workspace — scope_required', () => {
  it('maps ScopeRequiredError from the store to structured error; never invokes gws', async () => {
    const store = fakeStore();
    store.getValidAccessToken = vi.fn(async () => {
      throw new ScopeRequiredError();
    });
    const fakeExec = vi.fn<ExecFileLike>();
    const tool = createCallWorkspaceTool({ store, uid: 'u', execFile: fakeExec });
    const r = await exec(tool, { service: 'gmail', resource: 'messages', method: 'list' });
    expect(r).toMatchObject({ status: 'error', code: 'scope_required' });
    expect(fakeExec).not.toHaveBeenCalled();
  });

  it('treats exit code 2 as scope_required and deletes the Firestore doc', async () => {
    const store = fakeStore();
    const fakeExec = vi.fn<ExecFileLike>(async () => ({
      stdout: '',
      stderr: 'auth failed',
      code: 2,
    }));
    const tool = createCallWorkspaceTool({ store, uid: 'u-1', execFile: fakeExec });
    const r = await exec(tool, { service: 'gmail', resource: 'messages', method: 'list' });
    expect(r.status).toBe('error');
    if (r.status === 'error') {
      expect(r.code).toBe('scope_required');
    }
    expect(store.delete).toHaveBeenCalledWith('u-1');
  });
});

describe('call_workspace — params JSON parsing', () => {
  it('accepts empty/omitted params', async () => {
    const fakeExec = vi.fn<ExecFileLike>(async () => ({
      stdout: JSON.stringify({ ok: true }),
      stderr: '',
      code: 0,
    }));
    const tool = createCallWorkspaceTool({
      store: fakeStore(),
      uid: 'u',
      execFile: fakeExec,
    });
    const r = await exec(tool, { service: 'tasks', resource: 'tasklists', method: 'list' });
    expect(r.status).toBe('ok');
    // argv[4] is the JSON stringification of {} when no params are given.
    const argv = fakeExec.mock.calls[0]?.[1] as string[];
    expect(argv[4]).toBe('{}');
  });

  it('returns invalid_args when params is not valid JSON', async () => {
    const fakeExec = vi.fn<ExecFileLike>();
    const tool = createCallWorkspaceTool({
      store: fakeStore(),
      uid: 'u',
      execFile: fakeExec,
    });
    const r = await exec(tool, {
      service: 'gmail',
      resource: 'messages',
      method: 'list',
      params: 'not json {',
    });
    expect(r).toMatchObject({ status: 'error', code: 'invalid_args' });
    expect(fakeExec).not.toHaveBeenCalled();
  });

  it('returns invalid_args when params JSON is not an object', async () => {
    const fakeExec = vi.fn<ExecFileLike>();
    const tool = createCallWorkspaceTool({
      store: fakeStore(),
      uid: 'u',
      execFile: fakeExec,
    });
    const r = await exec(tool, {
      service: 'gmail',
      resource: 'messages',
      method: 'list',
      params: '[1,2,3]',
    });
    expect(r).toMatchObject({ status: 'error', code: 'invalid_args' });
    expect(fakeExec).not.toHaveBeenCalled();
  });
});

describe('call_workspace — upstream / invalid_args', () => {
  it('falls back to upstream and redacts tokens when stderr matches no specific code', async () => {
    const fakeExec = vi.fn<ExecFileLike>(async () => ({
      stdout: '',
      stderr: 'ya29.maybe-a-leaked-token-in-error\nunexpected internal failure',
      code: 4,
    }));
    const tool = createCallWorkspaceTool({
      store: fakeStore(),
      uid: 'u',
      execFile: fakeExec,
    });
    const r = await exec(tool, { service: 'gmail', resource: 'messages', method: 'list' });
    expect(r.status).toBe('error');
    if (r.status === 'error') {
      expect(r.code).toBe('upstream');
      expect(r.message).not.toContain('ya29.');
      expect(r.message).toContain('[redacted]');
      expect(r.exitCode).toBe(4);
    }
  });

  it('rejects unknown services before invoking the CLI', async () => {
    const fakeExec = vi.fn<ExecFileLike>();
    const tool = createCallWorkspaceTool({
      store: fakeStore(),
      uid: 'u',
      execFile: fakeExec,
    });
    // Zod will catch this before execute() runs in a real FunctionTool call,
    // but we also have an internal allowlist guard. Exercise it directly by
    // invoking execute() with a bogus service.
    const r = await exec(tool, {
      service: 'drive',
      resource: 'files',
      method: 'list',
    });
    expect(r).toMatchObject({ status: 'error', code: 'invalid_args' });
    expect(fakeExec).not.toHaveBeenCalled();
  });
});

describe('classifyError — fine-grained error codes', () => {
  function asJsonError(httpCode: number, reason: string, message = '') {
    return JSON.stringify({ error: { code: httpCode, reason, message } });
  }

  it('maps 401 / unauthorized → scope_required', () => {
    expect(classifyError(asJsonError(401, 'unauthenticated', 'invalid_grant'), '', 1)).toBe(
      'scope_required',
    );
    expect(classifyError('', 'error: 401 Unauthorized', 1)).toBe('scope_required');
    expect(classifyError('', 'invalid_grant: token expired', 1)).toBe('scope_required');
  });

  it('maps 403 with scope-flavoured wording → scope_required, plain 403 → forbidden', () => {
    expect(
      classifyError(asJsonError(403, 'forbidden', 'insufficient authentication scopes'), '', 1),
    ).toBe('scope_required');
    expect(
      classifyError(asJsonError(403, 'forbidden', 'caller has no access to event'), '', 1),
    ).toBe('forbidden');
  });

  it('maps TLS / connection / DNS errors → network', () => {
    const stderr =
      'error[discovery]: error sending request for url (...): client error (Connect): invalid peer certificate: UnknownIssuer';
    expect(classifyError(asJsonError(500, 'discoveryError', stderr), stderr, 4)).toBe('network');
    expect(classifyError('', 'error[discovery]: Permission denied (os error 13)', 4)).toBe(
      'network',
    );
    expect(classifyError('', 'tcp connect timed out', 4)).toBe('network');
  });

  it('maps 429 / quota / rate limit → rate_limited', () => {
    expect(classifyError(asJsonError(429, 'rateLimitExceeded', 'Rate Limit Exceeded'), '', 1)).toBe(
      'rate_limited',
    );
    expect(classifyError('', 'quota exceeded for service', 1)).toBe('rate_limited');
  });

  it('maps 404 → not_found', () => {
    expect(classifyError(asJsonError(404, 'notFound', 'Event not found'), '', 1)).toBe('not_found');
    expect(classifyError('', 'error: 404 Not Found', 1)).toBe('not_found');
  });

  it('maps 400 → bad_request', () => {
    expect(
      classifyError(asJsonError(400, 'badRequest', 'Invalid value at request.timeMin'), '', 1),
    ).toBe('bad_request');
  });

  it('falls back to scope_required for gws exit codes 2 and 3', () => {
    expect(classifyError('', '', 2)).toBe('scope_required');
    expect(classifyError('', '', 3)).toBe('scope_required');
  });

  it('falls back to upstream for everything else', () => {
    expect(classifyError('', '', 1)).toBe('upstream');
    expect(classifyError(asJsonError(500, 'backendError', 'oh no'), '', 1)).toBe('upstream');
  });
});

describe('call_workspace — fine-grained error mapping in the tool', () => {
  it('classifies a TLS discovery failure as network (not scope_required)', async () => {
    const fakeExec = vi.fn<ExecFileLike>(async () => ({
      stdout:
        '{"error":{"code":500,"reason":"discoveryError","message":"client error (Connect): invalid peer certificate"}}',
      stderr: 'error[discovery]: invalid peer certificate: UnknownIssuer',
      code: 4,
    }));
    const store = fakeStore();
    const tool = createCallWorkspaceTool({ store, uid: 'u', execFile: fakeExec });
    const r = await exec(tool, { service: 'gmail', resource: 'messages', method: 'list' });
    expect(r).toMatchObject({ status: 'error', code: 'network' });
    // Critical: a transient network error must NOT delete the user's tokens.
    expect(store.delete).not.toHaveBeenCalled();
  });

  it('classifies a 429 response as rate_limited and preserves tokens', async () => {
    const fakeExec = vi.fn<ExecFileLike>(async () => ({
      stdout: '{"error":{"code":429,"reason":"rateLimitExceeded","message":"Rate Limit Exceeded"}}',
      stderr: '',
      code: 4,
    }));
    const store = fakeStore();
    const tool = createCallWorkspaceTool({ store, uid: 'u', execFile: fakeExec });
    const r = await exec(tool, { service: 'gmail', resource: 'messages', method: 'list' });
    expect(r).toMatchObject({ status: 'error', code: 'rate_limited' });
    expect(store.delete).not.toHaveBeenCalled();
  });

  it('classifies a 401 response as scope_required and deletes tokens', async () => {
    const fakeExec = vi.fn<ExecFileLike>(async () => ({
      stdout: '{"error":{"code":401,"reason":"unauthenticated","message":"invalid_grant"}}',
      stderr: '',
      code: 4,
    }));
    const store = fakeStore();
    const tool = createCallWorkspaceTool({ store, uid: 'u-x', execFile: fakeExec });
    const r = await exec(tool, { service: 'gmail', resource: 'messages', method: 'list' });
    expect(r).toMatchObject({ status: 'error', code: 'scope_required' });
    expect(store.delete).toHaveBeenCalledWith('u-x');
  });

  it('classifies a 404 response as not_found and preserves tokens', async () => {
    const fakeExec = vi.fn<ExecFileLike>(async () => ({
      stdout: '{"error":{"code":404,"reason":"notFound","message":"Event not found"}}',
      stderr: '',
      code: 4,
    }));
    const store = fakeStore();
    const tool = createCallWorkspaceTool({ store, uid: 'u', execFile: fakeExec });
    const r = await exec(tool, { service: 'calendar', resource: 'events', method: 'get' });
    expect(r).toMatchObject({ status: 'error', code: 'not_found' });
    expect(store.delete).not.toHaveBeenCalled();
  });
});

describe('call_workspace — log sanitisation', () => {
  it('does not include the token in the log event payload', async () => {
    const logSpy = vi.fn();
    const token = 'ya29.super.secret';
    const fakeExec = vi.fn<ExecFileLike>(async () => ({
      stdout: '{"ok":true}',
      stderr: '',
      code: 0,
    }));
    const tool = createCallWorkspaceTool({
      store: fakeStore(token),
      uid: 'u',
      execFile: fakeExec,
      log: logSpy,
    });
    await exec(tool, { service: 'gmail', resource: 'messages', method: 'list' });
    expect(logSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(logSpy.mock.calls[0]?.[0] ?? {});
    expect(logged).not.toContain(token);
  });

  it('result does not contain any access_token/refresh_token key', async () => {
    const token = 'ya29.super.secret';
    const fakeExec = vi.fn<ExecFileLike>(async () => ({
      // Google error bodies sometimes echo partial tokens — we must not
      // relay that to the LLM.
      stdout: JSON.stringify({ ok: true }),
      stderr: '',
      code: 0,
    }));
    const tool = createCallWorkspaceTool({
      store: fakeStore(token),
      uid: 'u',
      execFile: fakeExec,
    });
    const r = await exec(tool, { service: 'gmail', resource: 'messages', method: 'list' });
    const serialised = JSON.stringify(r);
    expect(serialised).not.toContain(token);
    expect(serialised).not.toMatch(/access_token|refresh_token|client_secret/i);
  });
});
