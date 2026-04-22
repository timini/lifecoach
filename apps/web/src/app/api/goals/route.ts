export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/goals?userId=... → forwards to agent GET /goals */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const userId = url.searchParams.get('userId');
  if (!userId) return Response.json({ error: 'userId is required' }, { status: 400 });

  const agent = process.env.AGENT_URL;
  if (!agent) return Response.json({ error: 'AGENT_URL not configured' }, { status: 500 });

  const auth = request.headers.get('authorization') ?? '';
  const upstream = await fetch(`${agent}/goals?userId=${encodeURIComponent(userId)}`, {
    headers: auth ? { authorization: auth } : {},
  });
  if (upstream.status >= 400) {
    const text = await upstream.text().catch(() => '');
    return Response.json(
      { error: 'Upstream agent error', detail: text.slice(0, 500) },
      { status: 502 },
    );
  }
  const body = await upstream.json().catch(() => ({ updates: [] }));
  return Response.json(body, { status: 200 });
}
