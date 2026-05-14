import { ImageResponse } from 'next/og';
import { getFeaturePage } from '../../../lib/marketing/feature-pages';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

type OgProps = {
  params: Promise<{ topic: string }>;
};

export default async function Image({ params }: OgProps) {
  const { topic } = await params;
  const page = getFeaturePage(topic) ?? getFeaturePage('overwhelm');

  return new ImageResponse(
    <div
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        background: 'linear-gradient(135deg, #f8f0df 0%, #dfe9df 54%, #f3cdbf 100%)',
        color: '#243026',
        padding: 72,
        fontFamily: 'Inter, Arial, sans-serif',
      }}
    >
      <div style={{ fontSize: 36, fontWeight: 700 }}>Tranquil</div>
      <div>
        <div style={{ color: '#9f5f47', fontSize: 30, fontWeight: 700, marginBottom: 24 }}>
          {page?.eyebrow}
        </div>
        <div style={{ fontSize: 78, fontWeight: 700, lineHeight: 0.96, letterSpacing: -3 }}>
          {page?.h1}
        </div>
      </div>
      <div style={{ fontSize: 28, color: '#4d5d51' }}>{page?.ogTone}</div>
    </div>,
    size,
  );
}
