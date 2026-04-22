export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/profile?userId=...     → forwards to agent GET /profile
 * PATCH /api/profile              → forwards to agent PATCH /profile (body: {profile})
 */

function agentUrl(): string | null {
  return process.env.AGENT_URL || null;
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const userId = url.searchParams.get('userId');
  if (!userId) return Response.json({ error: 'userId is required' }, { status: 400 });

  const agent = agentUrl();
  if (!agent) return Response.json({ error: 'AGENT_URL not configured' }, { status: 500 });

  const upstream = await fetch(`${agent}/profile?userId=${encodeURIComponent(userId)}`, {
    headers: {
      ...(request.headers.get('authorization')
        ? { authorization: request.headers.get('authorization') as string }
        : {}),
    },
  });
  if (upstream.status >= 400) {
    const text = await upstream.text().catch(() => '');
    return Response.json(
      { error: 'Upstream agent error', detail: text.slice(0, 500) },
      { status: 502 },
    );
  }
  const body = await upstream.json().catch(() => ({ profile: {} }));
  return Response.json(body, { status: 200 });
}

export async function PATCH(request: Request): Promise<Response> {
  const agent = agentUrl();
  if (!agent) return Response.json({ error: 'AGENT_URL not configured' }, { status: 500 });

  const auth = request.headers.get('authorization') ?? '';
  if (!auth) {
    // The agent requires a verified token for PATCH; fail fast on the web
    // side rather than round-tripping to get the same 401.
    return Response.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const body = await request.text();
  const upstream = await fetch(`${agent}/profile`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: auth },
    body,
  });
  if (upstream.status >= 400) {
    const text = await upstream.text().catch(() => '');
    return Response.json(
      { error: 'Upstream agent error', detail: text.slice(0, 500) },
      { status: upstream.status === 401 ? 401 : 502 },
    );
  }
  const respBody = await upstream.json().catch(() => ({ status: 'ok' }));
  return Response.json(respBody, { status: 200 });
}
