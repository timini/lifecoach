export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/sessions
 * Forwards to the agent's /sessions endpoint. The agent is the source of
 * truth for session metadata (Firestore-backed). Bearer-auth scopes the
 * uid; we don't accept a uid query param at all (unlike /history) — the
 * listing is always for the authenticated caller.
 */
export async function GET(request: Request): Promise<Response> {
  const agentUrl = process.env.AGENT_URL;
  if (!agentUrl) {
    return Response.json({ error: 'AGENT_URL is not configured' }, { status: 500 });
  }

  const authHeader = request.headers.get('authorization') ?? '';
  const upstream = await fetch(`${agentUrl}/sessions`, {
    method: 'GET',
    headers: {
      ...(authHeader ? { authorization: authHeader } : {}),
    },
  });

  if (upstream.status >= 400) {
    const text = await upstream.text().catch(() => '');
    return Response.json(
      { error: 'Upstream agent error', detail: text.slice(0, 500) },
      { status: upstream.status === 401 ? 401 : 502 },
    );
  }

  const body = await upstream.json().catch(() => ({ sessions: [] }));
  return Response.json(body, { status: 200 });
}
