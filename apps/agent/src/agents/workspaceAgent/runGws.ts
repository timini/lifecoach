import { ScopeRequiredError, type WorkspaceTokensStore } from '../../storage/workspaceTokens.js';
import {
  AUTH_ERROR_CODES,
  type ExecFileLike,
  type GwsErrorCode,
  classifyError,
  defaultExecFile,
  sampleForLog,
  sanitiseStderr,
  truncateStdout,
} from './gwsExec.js';

/**
 * One-call helper that wraps the auth + exec + classify + log flow used by
 * every workspace tool (sub-agent reads, main-facing writes). Tools call
 * this with structured args; everything below the helper is plumbing.
 *
 * Behaviour matches the original `createCallWorkspaceTool` execute()
 * function, lifted into a shape that's reusable across many tools.
 *
 * - On `scope_required`, deletes the user's token doc so the next turn
 *   drops back to `google_linked` and the LLM invites reconnect.
 * - Returns the parsed JSON body on success (or the raw text if not
 *   parseable JSON — same as the original behaviour).
 * - Truncates stdout at MAX_STDOUT_BYTES (32 KB) before parsing.
 * - The `log` callback receives a sanitised event per call. Tokens are
 *   never present in `args`, `params`, `body`, `stdoutSample`, or
 *   `stderrSample` (regex-redacted before logging).
 */

export type RunGwsResult =
  | { status: 'ok'; body: unknown; truncated?: boolean }
  | { status: 'error'; code: GwsErrorCode; message: string; exitCode?: number | null };

export interface RunGwsLogEvent {
  /** Tool name making the call — `list_inbox`, `archive_messages`, etc. */
  name: string;
  service: string;
  resource: string;
  method: string;
  exitCode: number | null;
  stdoutBytes: number;
  outcome: 'ok' | GwsErrorCode;
  stderrSample?: string;
  stdoutSample?: string;
}

export interface RunGwsArgs {
  store: WorkspaceTokensStore;
  uid: string;
  /** Tool name for log emission. */
  toolName: string;
  service: 'gmail' | 'calendar' | 'tasks';
  /** Dotted resource path, e.g. `users.messages`, `events`, `tasks`. */
  resource: string;
  /** API method: `list`, `get`, `insert`, `modify`, `update`, `delete`. */
  method: string;
  /** Path/query params (gws --params). Object — gets JSON-stringified. */
  params?: Record<string, unknown>;
  /** Body (gws --json). Object/array — gets JSON-stringified. */
  body?: unknown;

  execFile?: ExecFileLike;
  /** Per-call timeout (ms). Default 20s. */
  timeoutMs?: number;
  /** Binary path. Default `gws`. */
  gwsPath?: string;
  log?: (event: RunGwsLogEvent) => void;
}

export async function runGws(args: RunGwsArgs): Promise<RunGwsResult> {
  const {
    store,
    uid,
    toolName,
    service,
    resource,
    method,
    params = {},
    body,
    execFile: exec = defaultExecFile,
    timeoutMs = 20_000,
    gwsPath = 'gws',
    log = () => undefined,
  } = args;

  // Resolve token — may throw ScopeRequiredError, which maps directly to a
  // structured error the LLM can interpret.
  let accessToken: string;
  try {
    accessToken = await store.getValidAccessToken(uid);
  } catch (err) {
    if (err instanceof ScopeRequiredError) {
      log({
        name: toolName,
        service,
        resource,
        method,
        exitCode: null,
        stdoutBytes: 0,
        outcome: 'scope_required',
      });
      return { status: 'error', code: 'scope_required', message: err.message };
    }
    throw err;
  }

  const resourcePath = resource.split('.').filter(Boolean);
  const argv = [service, ...resourcePath, method, '--params', JSON.stringify(params)];
  if (body !== undefined) {
    argv.push('--json', JSON.stringify(body));
  }

  const res = await exec(gwsPath, argv, {
    env: { ...process.env, GOOGLE_WORKSPACE_CLI_TOKEN: accessToken },
    timeout: timeoutMs,
  });

  if (res.code === 0) {
    const { text, truncated } = truncateStdout(res.stdout);
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Keep as string if not parseable JSON.
    }
    log({
      name: toolName,
      service,
      resource,
      method,
      exitCode: 0,
      stdoutBytes: Buffer.byteLength(res.stdout, 'utf8'),
      outcome: 'ok',
    });
    return truncated ? { status: 'ok', body: parsed, truncated } : { status: 'ok', body: parsed };
  }

  const code = classifyError(res.stdout, res.stderr, res.code);
  if (AUTH_ERROR_CODES.has(code)) {
    await store.delete(uid).catch(() => undefined);
  }
  const message =
    code === 'scope_required'
      ? 'Workspace access expired. Ask the user to reconnect in Settings.'
      : sanitiseStderr(res.stderr) || sanitiseStderr(res.stdout);
  log({
    name: toolName,
    service,
    resource,
    method,
    exitCode: res.code,
    stdoutBytes: Buffer.byteLength(res.stdout, 'utf8'),
    outcome: code,
    stderrSample: sampleForLog(res.stderr),
    stdoutSample: sampleForLog(res.stdout),
  });
  return { status: 'error', code, message, exitCode: res.code };
}
