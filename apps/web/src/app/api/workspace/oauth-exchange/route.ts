export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/workspace/oauth-exchange  body:{code}
 *
 * Bearer-only. Forwards the GIS popup's auth code to the agent's
 * /workspace/oauth-exchange, which does the code-for-tokens exchange and
 * stores tokens in Firestore.
 *
 * This proxy never reads the code, never logs it, and never inspects the
 * response beyond passing it back. The client never sees token values —
 * the agent's response only includes {connected, scopes, grantedAt}.
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
  const upstream = await fetch(`${agent}/workspace/oauth-exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: auth },
    body,
  });
  if (upstream.status >= 400) {
    // Don't echo upstream text — it might reference the code. Agent
    // already sanitises; belt-and-braces here.
    return Response.json(
      { error: 'oauth_exchange_failed' },
      { status: upstream.status === 401 ? 401 : 502 },
    );
  }
  const respBody = await upstream.json().catch(() => ({ connected: false }));
  return Response.json(respBody, { status: 200 });
}
