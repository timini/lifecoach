export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function agentInternalHeaders(): Record<string, string> {
  const bearer = process.env.AGENT_INTERNAL_BEARER;
  return bearer ? { 'x-agent-internal-bearer': bearer } : {};
}

/**
 * GET /api/chat/history?sessionId=...
 * Forwards to the agent's /history endpoint. The agent is the source of
 * truth for session events (Firestore-backed).
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const userId = url.searchParams.get('userId');
  const sessionId = url.searchParams.get('sessionId');
  if (!userId || !sessionId) {
    return Response.json({ error: 'userId and sessionId are required' }, { status: 400 });
  }

  const agentUrl = process.env.AGENT_URL;
  if (!agentUrl) {
    return Response.json({ error: 'AGENT_URL is not configured' }, { status: 500 });
  }

  const authHeader = request.headers.get('authorization') ?? '';
  const upstream = await fetch(
    `${agentUrl}/history?userId=${encodeURIComponent(userId)}&sessionId=${encodeURIComponent(sessionId)}`,
    {
      method: 'GET',
      headers: {
        ...agentInternalHeaders(),
        ...(authHeader ? { authorization: authHeader } : {}),
      },
    },
  );

  if (upstream.status >= 400) {
    const text = await upstream.text().catch(() => '');
    return Response.json(
      { error: 'Upstream agent error', detail: text.slice(0, 500) },
      { status: 502 },
    );
  }

  const body = await upstream.json().catch(() => ({ events: [] }));
  return Response.json(body, { status: 200 });
}
