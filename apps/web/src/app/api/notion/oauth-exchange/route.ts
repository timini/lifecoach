import { agentInternalHeaders } from '../../../../lib/agentHeaders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/notion/oauth-exchange  body:{code, redirect_uri}
 *
 * Bearer-only. Forwards the popup's auth code + the exact redirect URI
 * (must match what was used in the authorize URL) to the agent. The
 * agent does the code-for-tokens exchange via Notion's
 * /v1/oauth/token and persists the tokens to Firestore.
 *
 * This proxy never reads the code, never logs it, and never inspects
 * the response beyond passing it back. The client never sees token
 * values — the agent's response only includes
 * {connected, workspaceName, grantedAt}.
 */

function agentUrl(): string | null {
  return process.env.AGENT_URL || null;
}

export async function POST(request: Request): Promise<Response> {
  const agent = agentUrl();
  if (!agent) return Response.json({ error: 'AGENT_URL not configured' }, { status: 500 });

  const auth = request.headers.get('authorization') ?? '';
  if (!auth) return Response.json({ error: 'unauthenticated' }, { status: 401 });

  const body = await request.text();
  const upstream = await fetch(`${agent}/notion/oauth-exchange`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: auth,
      ...agentInternalHeaders(),
    },
    body,
  });
  if (upstream.status >= 400) {
    return Response.json(
      { error: 'oauth_exchange_failed' },
      { status: upstream.status === 401 ? 401 : 502 },
    );
  }
  const respBody = await upstream.json().catch(() => ({ connected: false }));
  return Response.json(respBody, { status: 200 });
}
