import { notFound } from 'next/navigation';
import { ImageResponse } from 'next/og';
import { getHelpTopic } from '../../../../content/seo';

export const runtime = 'edge';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

type Props = { params: Promise<{ topic: string }> };

export default async function Image({ params }: Props) {
  const { topic: slug } = await params;
  const topic = getHelpTopic(slug);
  if (!topic) notFound();

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: 72,
        background: '#fbf7ef',
        color: '#243027',
        fontFamily: 'Inter, sans-serif',
      }}
    >
      <div style={{ fontSize: 34, fontWeight: 700 }}>Lifecoach</div>
      <div>
        <div style={{ color: '#6f7f68', fontSize: 28, fontWeight: 700, marginBottom: 24 }}>
          {topic.audience}
        </div>
        <div style={{ fontSize: 78, fontWeight: 800, lineHeight: 1.02, letterSpacing: -3 }}>
          {topic.h1}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 24 }}>
        {topic.keyphrases.slice(0, 3).map((phrase) => (
          <span
            key={phrase}
            style={{ border: '2px solid #d9cec0', borderRadius: 999, padding: '12px 20px' }}
          >
            {phrase}
          </span>
        ))}
      </div>
    </div>,
    size,
  );
}
