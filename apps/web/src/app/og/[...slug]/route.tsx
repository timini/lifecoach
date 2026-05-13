import { ImageResponse } from 'next/og';
import { blogPosts, featureTopics } from '../../../content/marketing';

export const runtime = 'edge';

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const path = slug.join('/');
  const feature = path.startsWith('how-it-helps/')
    ? featureTopics.find((topic) => path === `how-it-helps/${topic.slug}`)
    : undefined;
  const post = path.startsWith('blog/')
    ? blogPosts.find((blogPost) => path === `blog/${blogPost.slug}`)
    : undefined;

  const title = feature?.title ?? post?.title ?? 'Lifecoach blog';
  const eyebrow = feature?.eyebrow ?? post?.type ?? 'The AI assistant that prevents overwhelm';
  const description =
    feature?.metaDescription ??
    post?.description ??
    'Evidence-backed and lived-experience writing about overwhelm, ADHD, depression, and daily admin.';

  return new ImageResponse(
    <div
      style={{
        alignItems: 'stretch',
        background: '#f6efe3',
        color: '#23201d',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'Inter, sans-serif',
        height: '100%',
        justifyContent: 'space-between',
        padding: 72,
        width: '100%',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 34, fontWeight: 700 }}>Lifecoach</div>
        <div
          style={{
            background: '#d7e3d3',
            borderRadius: 999,
            fontSize: 24,
            fontWeight: 700,
            padding: '14px 24px',
          }}
        >
          {eyebrow}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
        <div
          style={{ fontFamily: 'Georgia, serif', fontSize: 68, fontWeight: 700, lineHeight: 1.04 }}
        >
          {title}
        </div>
        <div style={{ color: '#6f665d', fontSize: 30, lineHeight: 1.35, maxWidth: 940 }}>
          {description}
        </div>
      </div>
      <div style={{ color: '#6f665d', fontSize: 26 }}>lifecoach.timini.dev</div>
    </div>,
    { width: 1200, height: 630 },
  );
}
