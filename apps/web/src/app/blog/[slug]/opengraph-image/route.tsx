import { notFound } from 'next/navigation';
import { ImageResponse } from 'next/og';
import { getBlogPost } from '../../../../content/seo';

export const runtime = 'edge';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

type Props = { params: Promise<{ slug: string }> };

export default async function Image({ params }: Props) {
  const { slug } = await params;
  const post = getBlogPost(slug);
  if (!post) notFound();

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: 72,
        background: '#243027',
        color: '#fbf7ef',
        fontFamily: 'Inter, sans-serif',
      }}
    >
      <div style={{ fontSize: 34, fontWeight: 700 }}>Lifecoach blog</div>
      <div>
        <div style={{ color: '#d8b29f', fontSize: 28, fontWeight: 700, marginBottom: 24 }}>
          {post.type} · {post.targetSubreddit}
        </div>
        <div style={{ fontSize: 76, fontWeight: 800, lineHeight: 1.02, letterSpacing: -3 }}>
          {post.title}
        </div>
      </div>
      <div style={{ fontSize: 26, color: '#e9ded2' }}>{post.description}</div>
    </div>,
    size,
  );
}
