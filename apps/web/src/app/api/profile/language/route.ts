import { cookies } from 'next/headers';
import { isLocale } from '../../../../i18n/routing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COOKIE_NAME = 'NEXT_LOCALE';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function agentUrl(): string | null {
  return process.env.AGENT_URL || null;
}

/**
 * POST /api/profile/language { language: 'en' | 'fr' }
 *
 * Persists `profile.language` via the agent's PATCH /profile and sets the
 * `NEXT_LOCALE` cookie so the next request renders in the chosen locale.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }
  const language = (body as { language?: string } | null)?.language;
  if (!isLocale(language)) {
    return Response.json({ error: 'invalid language' }, { status: 400 });
  }

  const auth = request.headers.get('authorization') ?? '';
  if (!auth) {
    return Response.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const agent = agentUrl();
  if (!agent) {
    return Response.json({ error: 'AGENT_URL not configured' }, { status: 500 });
  }

  const upstream = await fetch(`${agent}/profile`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: auth },
    body: JSON.stringify({ profile: { language } }),
  });
  if (upstream.status >= 400) {
    const text = await upstream.text().catch(() => '');
    return Response.json(
      { error: 'Upstream agent error', detail: text.slice(0, 500) },
      { status: upstream.status === 401 ? 401 : 502 },
    );
  }

  const jar = await cookies();
  jar.set(COOKIE_NAME, language, {
    maxAge: COOKIE_MAX_AGE,
    sameSite: 'lax',
    path: '/',
  });

  return Response.json({ status: 'ok', language }, { status: 200 });
}
