import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  formatPostDate,
  getBlogPost,
  getBlogPosts,
  renderMarkdownBlocks,
} from '../../../lib/marketing/blog';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://lifecoach.ai';

type BlogPostPageProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return getBlogPosts().map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: BlogPostPageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = getBlogPost(slug);
  if (!post) {
    return {};
  }

  return {
    title: `${post.title} | Lifecoach`,
    description: post.description,
    alternates: { canonical: `/blog/${post.slug}` },
    keywords: post.tags,
    openGraph: {
      title: post.title,
      description: post.description,
      url: `/blog/${post.slug}`,
      type: 'article',
      publishedTime: post.date,
      tags: post.tags,
    },
  };
}

export default async function BlogPostPage({ params }: BlogPostPageProps) {
  const { slug } = await params;
  const post = getBlogPost(slug);
  if (!post) {
    notFound();
  }

  const articleJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    author: { '@type': 'Organization', name: 'Lifecoach' },
    publisher: { '@type': 'Organization', name: 'Lifecoach' },
    mainEntityOfPage: `${siteUrl}/blog/${post.slug}`,
    keywords: post.tags.join(', '),
  };
  const redditShareUrl = `https://www.reddit.com/r/${post.targetSubreddit.replace('r/', '')}/submit?url=${encodeURIComponent(`${siteUrl}/blog/${post.slug}`)}&title=${encodeURIComponent(post.title)}`;

  return (
    <main className="min-h-screen overflow-hidden px-5 py-6 sm:px-8 lg:px-12">
      <script type="application/ld+json">{JSON.stringify(articleJsonLd)}</script>
      <div className="absolute inset-x-0 top-0 -z-10 h-[520px] bg-[radial-gradient(circle_at_22%_15%,rgba(123,154,134,0.22),transparent_34%),radial-gradient(circle_at_85%_4%,rgba(198,123,99,0.16),transparent_34%)]" />
      <nav className="mx-auto flex max-w-7xl items-center justify-between rounded-full border border-border/70 bg-background/80 px-4 py-3 shadow-sm backdrop-blur">
        <a href="/" className="font-serif text-2xl font-semibold tracking-tight text-foreground">
          Lifecoach
        </a>
        <a
          href="/blog"
          className="text-sm font-semibold text-muted-foreground transition hover:text-foreground"
        >
          Blog index
        </a>
      </nav>

      <article className="mx-auto max-w-3xl pb-20 pt-16 lg:pt-24">
        <div className="flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-accent">
          <span>{post.type.replace('-', ' ')}</span>
          <span>•</span>
          <span>{post.targetSubreddit}</span>
          <span>•</span>
          <time dateTime={post.date}>{formatPostDate(post.date)}</time>
        </div>
        <h1 className="mt-5 text-balance font-serif text-5xl font-semibold leading-[1.04] tracking-tight text-foreground sm:text-6xl">
          {post.title}
        </h1>
        <p className="mt-6 text-pretty text-xl leading-8 text-muted-foreground">
          {post.description}
        </p>
        <a
          href={redditShareUrl}
          className="mt-8 inline-flex rounded-full border border-border bg-background/75 px-5 py-3 text-sm font-semibold text-foreground shadow-sm transition hover:-translate-y-0.5 hover:border-accent"
        >
          Share carefully to {post.targetSubreddit}
        </a>

        <div className="mt-12 space-y-6 rounded-[2rem] border border-border bg-background/85 p-7 shadow-sm sm:p-9">
          {renderMarkdownBlocks(post.body).map((block, index) => {
            if (block.type === 'h2') {
              return (
                <h2
                  key={`${block.type}-${index}`}
                  className="pt-4 font-serif text-3xl font-semibold text-foreground"
                >
                  {block.content}
                </h2>
              );
            }
            if (block.type === 'ul') {
              return (
                <ul
                  key={`${block.type}-${index}`}
                  className="list-disc space-y-2 pl-6 leading-8 text-muted-foreground"
                >
                  {(block.content as string[]).map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              );
            }
            return (
              <p key={`${block.type}-${index}`} className="text-lg leading-8 text-muted-foreground">
                {block.content}
              </p>
            );
          })}
        </div>
      </article>
    </main>
  );
}
