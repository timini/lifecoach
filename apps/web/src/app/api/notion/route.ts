import { agentInternalHeaders } from '../../../lib/agentHeaders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * DELETE /api/notion
 *
 * Bearer-only proxy → agent DELETE /notion. The agent deletes our
 * token + config docs. Note: Notion has no programmatic revoke; the
 * user must also remove the integration at notion.so/my-integrations.
 * The agent's response carries a `note` field surfacing that.
 */

function agentUrl(): string | null {
  return process.env.AGENT_URL || null;
}

export async function DELETE(request: Request): Promise<Response> {
  const agent = agentUrl();
  if (!agent) return Response.json({ error: 'AGENT_URL not configured' }, { status: 500 });

  const auth = request.headers.get('authorization') ?? '';
  if (!auth) return Response.json({ error: 'unauthenticated' }, { status: 401 });

  const upstream = await fetch(`${agent}/notion`, {
    method: 'DELETE',
    headers: {
      authorization: auth,
      ...agentInternalHeaders(),
    },
  });
  if (upstream.status >= 400) {
    return Response.json(
      { error: 'revoke_failed' },
      { status: upstream.status === 401 ? 401 : 502 },
    );
  }
  const respBody = await upstream
    .json()
    .catch(() => ({ connected: false, workspaceName: null, grantedAt: null }));
  return Response.json(respBody, { status: 200 });
}
