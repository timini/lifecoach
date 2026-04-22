export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/workspace/status
 * Bearer-only. Forwards to the agent's /workspace/status and returns
 * {connected, scopes, grantedAt}. Never includes token values.
 */

function agentUrl(): string | null {
  return process.env.AGENT_URL || null;
}

export async function GET(request: Request): Promise<Response> {
  const agent = agentUrl();
  if (!agent) return Response.json({ error: 'AGENT_URL not configured' }, { status: 500 });

  const auth = request.headers.get('authorization') ?? '';
  if (!auth) return Response.json({ error: 'unauthenticated' }, { status: 401 });

  const upstream = await fetch(`${agent}/workspace/status`, {
    headers: { authorization: auth },
  });
  if (upstream.status >= 400) {
    return Response.json(
      { error: 'status_failed' },
      { status: upstream.status === 401 ? 401 : 502 },
    );
  }
  const body = await upstream
    .json()
    .catch(() => ({ connected: false, scopes: [], grantedAt: null }));
  return Response.json(body, { status: 200 });
}
