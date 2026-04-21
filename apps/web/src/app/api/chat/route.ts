export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ChatBody {
  userId?: string;
  sessionId?: string;
  message?: string;
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as ChatBody;
  const { userId, sessionId, message } = body;
  if (!userId || !sessionId || !message) {
    return Response.json({ error: 'userId, sessionId, and message are required' }, { status: 400 });
  }

  const agentUrl = process.env.AGENT_URL;
  if (!agentUrl) {
    return Response.json({ error: 'AGENT_URL is not configured' }, { status: 500 });
  }

  const upstream = await fetch(`${agentUrl}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId, sessionId, message }),
  });

  if (upstream.status >= 400) {
    const text = await upstream.text().catch(() => '');
    return Response.json(
      { error: 'Upstream agent error', detail: text.slice(0, 500) },
      { status: 502 },
    );
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'text/event-stream',
      'cache-control': 'no-cache',
    },
  });
}
