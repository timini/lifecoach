import { getHelpTopic } from '@/lib/marketing';
import { ImageResponse } from 'next/og';

export const runtime = 'edge';

export async function GET(_request: Request, { params }: { params: Promise<{ topic: string }> }) {
  const { topic: slug } = await params;
  const topic = getHelpTopic(slug) ?? getHelpTopic('overwhelm');

  if (!topic) {
    return new Response('Not found', { status: 404 });
  }

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        background: '#f7efe3',
        color: '#243126',
        padding: 72,
        fontFamily: 'Inter, sans-serif',
      }}
    >
      <div
        style={{ display: 'flex', justifyContent: 'space-between', fontSize: 30, fontWeight: 700 }}
      >
        <span>Lifecoach</span>
        <span style={{ color: '#7b9a86' }}>{topic.audience}</span>
      </div>
      <div>
        <div style={{ fontSize: 78, lineHeight: 0.95, fontWeight: 700, letterSpacing: -3 }}>
          {topic.h1}
        </div>
        <div
          style={{ marginTop: 28, maxWidth: 900, fontSize: 30, lineHeight: 1.35, color: '#5f6b60' }}
        >
          {topic.description}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 16, fontSize: 24, color: '#8a4f3b' }}>
        {topic.keyphrases.slice(0, 3).map((phrase) => (
          <span
            key={phrase}
            style={{ border: '2px solid #d9cbb8', borderRadius: 999, padding: '12px 18px' }}
          >
            {phrase}
          </span>
        ))}
      </div>
    </div>,
    { width: 1200, height: 630 },
  );
}
