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

/**
 * Fine-grained error classification — each code maps to a specific user
 * action in the LLM's prompt cheat-sheet:
 *  - `scope_required`: token expired / scope missing → call connect_workspace
 *  - `forbidden`: 403 on a specific resource → tell user we lack access there
 *  - `network`: TLS / DNS / connection error → "had a hiccup, try again"
 *  - `rate_limited`: 429 / quota → "Google's rate-limiting us, hold on"
 *  - `not_found`: 404 → no item with that id; LLM continues
 *  - `bad_request`: 400 INVALID_ARGUMENT → silently retry with corrected params
 *  - `timeout`: exec exceeded timeout → "took too long, try again"
 *  - `upstream`: catchall (5xx, unknown) → "something unexpected, try again"
 *  - `invalid_args`: pre-flight, before exec — bad service/params from LLM
 */
export type CallWorkspaceErrorCode =
  | 'scope_required'
  | 'forbidden'
  | 'network'
  | 'rate_limited'
  | 'not_found'
  | 'bad_request'
  | 'timeout'
  | 'upstream'
  | 'invalid_args';

export interface CallWorkspaceResultErr {
  status: 'error';
  code: CallWorkspaceErrorCode;
  message: string;
  /** Present for non-pre-flight errors — the CLI exit code from `gws`. */
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

/**
 * Maps a `gws` failure into one of the fine-grained error codes the LLM
 * knows how to act on. Prefers the structured `{error: {code, reason,
 * message}}` envelope `gws` writes to stdout; falls back to stderr
 * pattern matching, then exit code, then `upstream` as a catchall.
 *
 * Exported for direct unit testing — call sites use it via the tool.
 */
export function classifyError(
  stdout: string,
  stderr: string,
  exitCode: number | null,
): CallWorkspaceErrorCode {
  // 1. Structured JSON error from gws stdout.
  const fromJson = classifyFromJson(stdout);
  if (fromJson) return fromJson;

  // 2. stderr pattern matching — gws sometimes prints lower-level errors
  // (TLS, file system, DNS) to stderr without a structured body.
  const fromStderr = classifyFromText(stderr);
  if (fromStderr) return fromStderr;

  // 3. Exit-code fallback. gws docs: 2 = unauthenticated, 3 = forbidden.
  if (exitCode === 2 || exitCode === 3) return 'scope_required';

  return 'upstream';
}

function classifyFromJson(stdout: string): CallWorkspaceErrorCode | null {
  try {
    const parsed = JSON.parse(stdout) as {
      error?: { code?: number; reason?: string; message?: string };
    };
    const e = parsed.error;
    if (!e) return null;
    const httpCode = typeof e.code === 'number' ? e.code : 0;
    const reason = (e.reason ?? '').toLowerCase();
    const message = e.message ?? '';
    const lcMessage = message.toLowerCase();

    // gws wraps low-level transport errors as {code: 500, reason:
    // discoveryError}. Treat anything with that signature OR with TLS-/
    // connect-flavoured text as a network error, regardless of httpCode.
    if (
      reason === 'discoveryerror' ||
      /peer cert|certificate|client error \(connect\)|os error|tcp|dns/i.test(message)
    ) {
      return 'network';
    }
    if (httpCode === 401 || /invalid_grant|invalid credential|unauthor/.test(lcMessage)) {
      return 'scope_required';
    }
    if (httpCode === 403) {
      // 403 with scope-flavoured wording = recoverable via reconnect; plain
      // 403 = the user's account lacks that specific permission, no
      // reconnect helps.
      if (/insufficient.*scope|scope|grant/.test(lcMessage)) return 'scope_required';
      return 'forbidden';
    }
    if (httpCode === 429 || reason === 'ratelimitexceeded' || /quota|rate.?limit/.test(lcMessage)) {
      return 'rate_limited';
    }
    if (httpCode === 404) return 'not_found';
    if (httpCode === 400) return 'bad_request';
    return 'upstream';
  } catch {
    return null;
  }
}

function classifyFromText(text: string): CallWorkspaceErrorCode | null {
  if (!text) return null;
  if (/peer cert|certificate|client error \(connect\)|os error|tcp connect|dns/i.test(text)) {
    return 'network';
  }
  if (/\b401\b|invalid_grant|unauthor|invalid credential/i.test(text)) return 'scope_required';
  if (/\b403\b|forbidden|permission denied/i.test(text)) return 'forbidden';
  if (/\b429\b|rate.?limit|quota/i.test(text)) return 'rate_limited';
  if (/\b404\b|not found/i.test(text)) return 'not_found';
  if (/\b400\b|bad request|invalid arg/i.test(text)) return 'bad_request';
  return null;
}

/** Codes that should drop the Firestore token doc — only auth-related ones. */
const AUTH_ERROR_CODES = new Set<CallWorkspaceErrorCode>(['scope_required']);

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
    /** First ~500 chars of stderr, token-redacted. Populated on error only. */
    stderrSample?: string;
    /** First ~500 chars of stdout, token-redacted. Populated on error only. */
    stdoutSample?: string;
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

  // NOTE: `params` is a JSON *string*, not a free-form object. Gemini's
  // function-calling schema doesn't reliably accept z.record/object-with-
  // additionalProperties, so we serialise and parse server-side. The LLM
  // gets a clear, predictable shape; we still preserve the generic
  // dispatch ergonomics.
  const parameters = z.object({
    service: z
      .enum(WORKSPACE_SERVICES as unknown as [string, ...string[]])
      .describe('Workspace service: gmail, calendar, or tasks.'),
    resource: z
      .string()
      .min(1)
      .describe(
        'Google API resource: "messages" for gmail; "events" or "calendars" for calendar; "tasks" or "tasklists" for tasks.',
      ),
    method: z
      .string()
      .min(1)
      .describe(
        'Method on the resource: "list", "get", "send", "modify", "trash", "insert", "patch", "delete".',
      ),
    params: z
      .string()
      .optional()
      .describe(
        'JSON-encoded request parameters per the Google Discovery spec. Example for gmail messages.list: \'{"q":"from:alex newer_than:7d","maxResults":5}\'. Omit for methods that take no params.',
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
      const rawArgs = input as {
        service: string;
        resource: string;
        method: string;
        params?: string;
      };

      // Parse the JSON-encoded params string. Invalid JSON surfaces as an
      // invalid_args error rather than silently dropping; the LLM retries
      // with a valid shape.
      let parsedParams: Record<string, unknown> = {};
      if (rawArgs.params && rawArgs.params.trim() !== '') {
        try {
          const j = JSON.parse(rawArgs.params);
          if (j && typeof j === 'object' && !Array.isArray(j)) {
            parsedParams = j as Record<string, unknown>;
          } else {
            return {
              status: 'error',
              code: 'invalid_args',
              message: 'params must be a JSON object string',
            };
          }
        } catch {
          return {
            status: 'error',
            code: 'invalid_args',
            message: 'params must be a JSON-encoded object string',
          };
        }
      }
      const args = {
        service: rawArgs.service,
        resource: rawArgs.resource,
        method: rawArgs.method,
        params: parsedParams,
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

      // gws follows the real Google Discovery API hierarchy:
      //   gws <service> <resource>[ <sub-resource>...] <method> --params <JSON> [--json <BODY>]
      // For Gmail messages this is `gws gmail users messages list` (not just
      // `gmail messages list`). We let the LLM pass `resource` as a dotted
      // path (e.g. "users.messages") and split it into separate argv pieces.
      //
      // Body splitting: gws's `--params` is for path/query parameters and
      // does NOT round-trip arrays correctly (it stringifies them, e.g.
      // `removeLabelIds: ["INBOX"]` becomes the literal "[\"INBOX\"]").
      // Body fields belong in `--json`. We let the LLM pass body fields
      // under a top-level `requestBody` key (matches the Google Discovery
      // convention used in the cheat-sheet) and route them automatically.
      const { requestBody, ...queryParams } = args.params as {
        requestBody?: unknown;
        [k: string]: unknown;
      };
      const paramsJson = JSON.stringify(queryParams);
      const resourcePath = args.resource.split('.').filter(Boolean);
      const argv = [args.service, ...resourcePath, args.method, '--params', paramsJson];
      if (requestBody !== undefined) {
        argv.push('--json', JSON.stringify(requestBody));
      }

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

      const code = classifyError(res.stdout, res.stderr, res.code);
      if (AUTH_ERROR_CODES.has(code)) {
        // Probably a silent token expiry between our refresh check and the
        // CLI's own call. Delete the doc so the next turn drops us back to
        // google_linked; LLM will then invite reconnect.
        await store.delete(uid).catch(() => undefined);
      }
      const message =
        code === 'scope_required'
          ? 'Workspace access expired. Ask the user to reconnect in Settings.'
          : sanitiseStderr(res.stderr) || sanitiseStderr(res.stdout);
      // On error, include a small sample of stderr + stdout in the
      // structured log so we can debug without re-running with new code.
      // Both are token-redacted via sanitiseStderr.
      log({
        tool: 'call_workspace',
        service: args.service,
        resource: args.resource,
        method: args.method,
        exitCode: res.code,
        stdoutBytes: Buffer.byteLength(res.stdout, 'utf8'),
        outcome: code,
        stderrSample: sampleForLog(res.stderr),
        stdoutSample: sampleForLog(res.stdout),
      });
      return { status: 'error', code, message, exitCode: res.code };
    },
  });
}

/**
 * Token-redacted sample of up to 500 chars. Strip newlines so the sample
 * fits on one log line. Used in the error-path log only; never for happy
 * paths (we don't want the full Gmail response body in logs).
 */
function sampleForLog(buf: string): string {
  if (!buf) return '';
  return buf
    .replace(/ya29\.[^\s]+/g, '[redacted]')
    .replace(/\s+/g, ' ')
    .slice(0, 500);
}
