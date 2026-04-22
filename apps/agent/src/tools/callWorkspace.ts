import { type ExecFileException, execFile } from 'node:child_process';
import { FunctionTool } from '@google/adk';
import { z } from 'zod';
import { ScopeRequiredError, type WorkspaceTokensStore } from '../storage/workspaceTokens.js';

/**
 * call_workspace — one generic dispatch tool covering Gmail, Calendar, Tasks
 * via the `gws` CLI (https://github.com/googleworkspace/cli).
 *
 * The LLM sees only business inputs: {service, resource, method, params}.
 * The handler (this module) looks up the user's access token server-side,
 * exports it via the child process's env, and invokes `gws` with argv only
 * (no shell). Token never appears in argv, stdout, stderr, or logs.
 *
 * Parallel-safe: each call is its own subprocess with its own env. Auth-
 * safe: GOOGLE_WORKSPACE_CLI_TOKEN is only in the child process env. Log-
 * safe: we emit only {tool, service, resource, method, exitCode,
 * stdoutBytes}. Never the token, never raw stderr, never full stdout.
 */

export const CALL_WORKSPACE_TOOL_NAME = 'call_workspace';

// Keep this enum in lockstep with the OAuth scopes granted on the client.
// Widening this enum without matching scope grants → 403 from Google →
// scope_required error surfaced to the LLM.
export const WORKSPACE_SERVICES = ['gmail', 'calendar', 'tasks'] as const;
export type WorkspaceService = (typeof WORKSPACE_SERVICES)[number];

/** Max stdout bytes we'll forward to the LLM. Larger responses are truncated. */
export const MAX_STDOUT_BYTES = 32 * 1024;

export interface CallWorkspaceResultOk {
  status: 'ok';
  body: unknown;
  /** True when stdout exceeded MAX_STDOUT_BYTES — caller should paginate. */
  truncated?: boolean;
}

export interface CallWorkspaceResultErr {
  status: 'error';
  code: 'scope_required' | 'upstream' | 'timeout' | 'invalid_args';
  message: string;
  /** Present only for `upstream`/`timeout` — the CLI exit code from `gws`. */
  exitCode?: number | null;
}

export type CallWorkspaceResult = CallWorkspaceResultOk | CallWorkspaceResultErr;

/** Injectable exec shape so tests don't spawn real subprocesses. */
export interface ExecFileResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

export type ExecFileLike = (
  file: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; timeout?: number },
) => Promise<ExecFileResult>;

/**
 * Default real-subprocess implementation. Exported for the runtime wiring
 * in server.ts. Tests pass a fake via `createCallWorkspaceTool`.
 */
export function defaultExecFile(
  file: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; timeout?: number },
): Promise<ExecFileResult> {
  return new Promise((resolve) => {
    execFile(file, args, options, (err, stdout, stderr) => {
      const e = err as (ExecFileException & { code?: number | null }) | null;
      resolve({
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        code: e?.code ?? (err ? 1 : 0),
      });
    });
  });
}

// Exit-code → error-code map for `gws`. The CLI documents exit codes 0-5;
// we treat 2/3 as auth-failure (from `gws` docs, unauthenticated/forbidden).
function classifyExit(code: number | null): 'scope_required' | 'upstream' {
  if (code === 2 || code === 3) return 'scope_required';
  return 'upstream';
}

function sanitiseStderr(stderr: string): string {
  // Take the first meaningful line; cap at 500 chars. Strip any obvious
  // auth-looking strings defensively — we should never see them here, but
  // belt and braces.
  const firstLine =
    stderr
      .split('\n')
      .map((s) => s.trim())
      .find(Boolean) ?? '';
  return firstLine.replace(/ya29\.[^\s]+/g, '[redacted]').slice(0, 500);
}

function truncateStdout(stdout: string): { text: string; truncated: boolean } {
  const buf = Buffer.from(stdout, 'utf8');
  if (buf.byteLength <= MAX_STDOUT_BYTES) {
    return { text: stdout, truncated: false };
  }
  return {
    text: buf.subarray(0, MAX_STDOUT_BYTES).toString('utf8'),
    truncated: true,
  };
}

export interface CreateCallWorkspaceToolDeps {
  store: WorkspaceTokensStore;
  uid: string;
  execFile?: ExecFileLike;
  /** Per-call timeout (ms). Default 20s. */
  timeoutMs?: number;
  /** Binary path. Default 'gws' (resolved via PATH in the Docker image). */
  gwsPath?: string;
  /**
   * Log emitter — one call per tool invocation, with sanitised fields only.
   * Pass a spy in tests to assert no token leakage.
   */
  log?: (event: {
    tool: 'call_workspace';
    service: string;
    resource: string;
    method: string;
    exitCode: number | null;
    stdoutBytes: number;
    outcome: 'ok' | CallWorkspaceResultErr['code'];
  }) => void;
}

export function createCallWorkspaceTool(deps: CreateCallWorkspaceToolDeps): FunctionTool {
  const {
    store,
    uid,
    execFile: exec = defaultExecFile,
    timeoutMs = 20_000,
    gwsPath = 'gws',
    log = () => undefined,
  } = deps;

  const parameters = z.object({
    service: z
      .enum(WORKSPACE_SERVICES as unknown as [string, ...string[]])
      .describe('Workspace service: gmail, calendar, or tasks.'),
    resource: z
      .string()
      .min(1)
      .describe(
        'Google API resource, e.g. "messages" for gmail, "events" for calendar, "tasks" or "tasklists" for tasks.',
      ),
    method: z
      .string()
      .min(1)
      .describe(
        'Method on the resource, e.g. "list", "get", "send", "modify", "trash", "insert", "patch", "delete".',
      ),
    params: z
      .record(z.unknown())
      .optional()
      .describe(
        'Request parameters per the Google Discovery spec. JSON object; passed as --params to gws.',
      ),
  });

  // biome-ignore lint/suspicious/noExplicitAny: zod nominal mismatch with ADK generics
  return new FunctionTool<any>({
    name: CALL_WORKSPACE_TOOL_NAME,
    description:
      'Perform a Google Workspace operation via the official gws CLI. Services: gmail, calendar, tasks. ' +
      'Use RFC3339 timestamps, Gmail search syntax (from:, newer_than:, label:INBOX, is:unread), ' +
      'and pass Discovery-spec parameters as a JSON object. The application handles authentication ' +
      'automatically — do not attempt to pass tokens or secrets.',
    parameters,
    execute: async (input: unknown): Promise<CallWorkspaceResult> => {
      const args = input as {
        service: string;
        resource: string;
        method: string;
        params?: Record<string, unknown>;
      };

      // Defence-in-depth: Zod enum already enforces this, but recheck so a
      // future Zod parameters change can't silently widen the attack
      // surface without failing this guard.
      if (!WORKSPACE_SERVICES.includes(args.service as WorkspaceService)) {
        const result: CallWorkspaceResultErr = {
          status: 'error',
          code: 'invalid_args',
          message: `service must be one of ${WORKSPACE_SERVICES.join(', ')}`,
        };
        log({
          tool: 'call_workspace',
          service: args.service,
          resource: args.resource,
          method: args.method,
          exitCode: null,
          stdoutBytes: 0,
          outcome: 'invalid_args',
        });
        return result;
      }

      // Resolve token — may throw ScopeRequiredError, which maps directly
      // to a structured error the LLM can interpret.
      let accessToken: string;
      try {
        accessToken = await store.getValidAccessToken(uid);
      } catch (err) {
        if (err instanceof ScopeRequiredError) {
          log({
            tool: 'call_workspace',
            service: args.service,
            resource: args.resource,
            method: args.method,
            exitCode: null,
            stdoutBytes: 0,
            outcome: 'scope_required',
          });
          return { status: 'error', code: 'scope_required', message: err.message };
        }
        throw err;
      }

      const paramsJson = JSON.stringify(args.params ?? {});
      const argv = [args.service, args.resource, args.method, '--params', paramsJson, '--json'];

      const res = await exec(gwsPath, argv, {
        env: { ...process.env, GOOGLE_WORKSPACE_CLI_TOKEN: accessToken },
        timeout: timeoutMs,
      });

      if (res.code === 0) {
        const { text, truncated } = truncateStdout(res.stdout);
        let body: unknown = text;
        try {
          body = JSON.parse(text);
        } catch {
          // Keep as string if not parseable JSON.
        }
        log({
          tool: 'call_workspace',
          service: args.service,
          resource: args.resource,
          method: args.method,
          exitCode: 0,
          stdoutBytes: Buffer.byteLength(res.stdout, 'utf8'),
          outcome: 'ok',
        });
        return truncated ? { status: 'ok', body, truncated } : { status: 'ok', body };
      }

      const code = classifyExit(res.code);
      if (code === 'scope_required') {
        // Probably a silent token expiry between our refresh check and the
        // CLI's own call. Delete the doc so the next turn drops us back to
        // google_linked; LLM will then invite reconnect.
        await store.delete(uid).catch(() => undefined);
      }
      const message =
        code === 'scope_required'
          ? 'Workspace access expired. Ask the user to reconnect in Settings.'
          : sanitiseStderr(res.stderr);
      log({
        tool: 'call_workspace',
        service: args.service,
        resource: args.resource,
        method: args.method,
        exitCode: res.code,
        stdoutBytes: Buffer.byteLength(res.stdout, 'utf8'),
        outcome: code,
      });
      return { status: 'error', code, message, exitCode: res.code };
    },
  });
}
