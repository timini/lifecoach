import { agentInternalHeaders } from '../../../../lib/agentHeaders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/notion/status
 *
 * Bearer-only proxy → agent /notion/status. Returns
 * {connected, workspaceName, grantedAt}. Used by the settings page
 * + the show_capabilities tile state.
 */

function agentUrl(): string | null {
  return process.env.AGENT_URL || null;
}

export async function GET(request: Request): Promise<Response> {
  const agent = agentUrl();
  if (!agent) return Response.json({ error: 'AGENT_URL not configured' }, { status: 500 });

  const auth = request.headers.get('authorization') ?? '';
  if (!auth) return Response.json({ error: 'unauthenticated' }, { status: 401 });

  const upstream = await fetch(`${agent}/notion/status`, {
    headers: {
      authorization: auth,
      ...agentInternalHeaders(),
    },
  });
  if (upstream.status === 401) {
    return Response.json(
      { connected: false, workspaceName: null, grantedAt: null },
      { status: 401 },
    );
  }
  if (upstream.status >= 400) {
    return Response.json({ error: 'status_failed' }, { status: 502 });
  }
  const respBody = await upstream
    .json()
    .catch(() => ({ connected: false, workspaceName: null, grantedAt: null }));
  return Response.json(respBody, { status: 200 });
}
