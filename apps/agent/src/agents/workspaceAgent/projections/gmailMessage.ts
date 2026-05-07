import type { MessageProjection } from '@lifecoach/shared-types';

/**
 * Project a raw `gmail.users.messages.get` (format=full) response into the
 * shape the LLM can actually read:
 *
 *   - `body.data` is base64url-encoded by the Gmail API (RFC 4648 §5).
 *     We walk the payload tree, pick the first text/plain part, fall back
 *     to text/html with a tag-strip if no plain part exists, and decode.
 *   - `payload.headers` is bloated with DKIM / ARC / Received chains we
 *     don't need. We allow-list the few that matter for triage.
 *   - The body is capped at 4 KB so a single chunky email can't blow the
 *     sub-agent's context budget.
 *
 * Pure function — the sub-agent's `get_message` tool calls into this after
 * the gws CLI returns. Same helper is reusable from any future caller.
 */

const ALLOWED_HEADERS = new Set([
  'from',
  'to',
  'cc',
  'bcc',
  'subject',
  'date',
  'reply-to',
  'list-unsubscribe',
  'message-id',
  'in-reply-to',
  'references',
]);

const BODY_BYTE_CAP = 4096;
const TRUNCATION_MARKER = '\n…[truncated]';

interface RawHeader {
  name: string;
  value: string;
}

interface RawPart {
  mimeType?: string;
  filename?: string;
  headers?: RawHeader[];
  body?: { data?: string; size?: number };
  parts?: RawPart[];
}

interface RawMessage {
  id?: string;
  threadId?: string;
  snippet?: string;
  payload?: RawPart;
}

export function projectGmailMessage(raw: RawMessage): MessageProjection {
  const payload = raw.payload ?? {};
  const headerMap = collectHeaders(payload.headers ?? []);

  const { body, truncated } = pickBody(payload);

  const projection: MessageProjection = {
    id: raw.id ?? '',
    threadId: raw.threadId ?? raw.id ?? '',
    from: headerMap.get('from') ?? '',
    subject: headerMap.get('subject') ?? '',
    date: headerMap.get('date') ?? '',
    snippet: raw.snippet ?? '',
    body,
    truncated,
  };

  const filteredHeaders = filterHeaders(headerMap);
  if (Object.keys(filteredHeaders).length > 0) {
    projection.headers = filteredHeaders;
  }

  return projection;
}

function collectHeaders(headers: RawHeader[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const h of headers) {
    if (!h.name) continue;
    const key = h.name.toLowerCase();
    // First wins — RFC 5322 says repeated headers are unusual; if Gmail
    // gives us multiples, the first is typically the canonical one.
    if (!map.has(key)) {
      map.set(key, h.value ?? '');
    }
  }
  return map;
}

function filterHeaders(headerMap: Map<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of headerMap) {
    if (!ALLOWED_HEADERS.has(key)) continue;
    // Skip the headers we've already promoted to top-level fields.
    if (key === 'from' || key === 'subject' || key === 'date') continue;
    out[canonicaliseHeaderName(key)] = value;
  }
  return out;
}

function canonicaliseHeaderName(lower: string): string {
  return lower
    .split('-')
    .map((seg) => {
      const first = seg.charAt(0);
      return first ? first.toUpperCase() + seg.slice(1) : seg;
    })
    .join('-');
}

function pickBody(payload: RawPart): { body: string; truncated: boolean } {
  const plain = findPart(payload, 'text/plain');
  if (plain) {
    return decodeAndCap(plain.body?.data ?? '');
  }
  const html = findPart(payload, 'text/html');
  if (html) {
    const decoded = decodeAndCap(html.body?.data ?? '');
    return { body: stripHtml(decoded.body), truncated: decoded.truncated };
  }
  // Top-level body (single-part messages put the body here directly).
  if (payload.body?.data) {
    return decodeAndCap(payload.body.data);
  }
  return { body: '', truncated: false };
}

function findPart(part: RawPart, mimeType: string): RawPart | null {
  if (part.mimeType === mimeType && part.body?.data) return part;
  if (!part.parts) return null;
  for (const child of part.parts) {
    const hit = findPart(child, mimeType);
    if (hit) return hit;
  }
  return null;
}

function decodeAndCap(b64url: string): { body: string; truncated: boolean } {
  if (!b64url) return { body: '', truncated: false };
  let decoded: string;
  try {
    decoded = Buffer.from(b64url, 'base64url').toString('utf8');
  } catch {
    return { body: '', truncated: false };
  }
  const buf = Buffer.from(decoded, 'utf8');
  if (buf.byteLength <= BODY_BYTE_CAP) {
    return { body: decoded, truncated: false };
  }
  return {
    body: buf.subarray(0, BODY_BYTE_CAP).toString('utf8') + TRUNCATION_MARKER,
    truncated: true,
  };
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
