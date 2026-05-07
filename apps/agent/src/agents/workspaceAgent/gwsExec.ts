import { type ExecFileException, execFile } from 'node:child_process';

/**
 * Shared `gws` CLI exec + error-classification utilities for the workspace
 * sub-agent. Lifted from the original `tools/callWorkspace.ts` so every
 * workspace tool (read, write, sub-agent internal) shares one auth-fail
 * detector, one stdout truncator, one log sanitiser.
 *
 * `tools/callWorkspace.ts` is being removed in the same Phase-2 PR; until
 * it is, it imports these utilities from here so behaviour is identical.
 *
 * Pure / IO-isolated:
 *   - `defaultExecFile` is the only IO-touching export; tests inject a
 *     fake matching `ExecFileLike`.
 *   - everything else is pure (string in, string out / classification).
 */

/** Max stdout bytes we'll forward to the LLM. Larger responses are truncated. */
export const MAX_STDOUT_BYTES = 32 * 1024;

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
export type GwsErrorCode =
  | 'scope_required'
  | 'forbidden'
  | 'network'
  | 'rate_limited'
  | 'not_found'
  | 'bad_request'
  | 'timeout'
  | 'upstream'
  | 'invalid_args';

/** Codes that should drop the Firestore token doc — only auth-related ones. */
export const AUTH_ERROR_CODES = new Set<GwsErrorCode>(['scope_required']);

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

/** Default real-subprocess implementation. Tests inject a fake. */
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
 * (or its caller) knows how to act on. Prefers the structured
 * `{error: {code, reason, message}}` envelope `gws` writes to stdout;
 * falls back to stderr pattern matching, then exit code, then `upstream`
 * as a catchall.
 */
export function classifyError(
  stdout: string,
  stderr: string,
  exitCode: number | null,
): GwsErrorCode {
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

function classifyFromJson(stdout: string): GwsErrorCode | null {
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

function classifyFromText(text: string): GwsErrorCode | null {
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

export function sanitiseStderr(stderr: string): string {
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

export function truncateStdout(stdout: string): { text: string; truncated: boolean } {
  const buf = Buffer.from(stdout, 'utf8');
  if (buf.byteLength <= MAX_STDOUT_BYTES) {
    return { text: stdout, truncated: false };
  }
  return {
    text: buf.subarray(0, MAX_STDOUT_BYTES).toString('utf8'),
    truncated: true,
  };
}

/**
 * Token-redacted sample of up to 500 chars. Strip newlines so the sample
 * fits on one log line. Used in error-path log output only; never for
 * happy paths (we don't want full Gmail response bodies in logs).
 */
export function sampleForLog(buf: string): string {
  if (!buf) return '';
  return buf
    .replace(/ya29\.[^\s]+/g, '[redacted]')
    .replace(/\s+/g, ' ')
    .slice(0, 500);
}
