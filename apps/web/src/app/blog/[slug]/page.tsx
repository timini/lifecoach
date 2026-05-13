import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { blogPosts, getBlogPost, siteUrl } from '../../../content/seo';

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return blogPosts.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = getBlogPost(slug);
  if (!post) return {};

  const url = `${siteUrl}/blog/${post.slug}`;
  return {
    title: `${post.title} | Lifecoach blog`,
    description: post.description,
    alternates: { canonical: url },
    keywords: post.tags,
    openGraph: {
      type: 'article',
      title: post.title,
      description: post.description,
      url,
      siteName: 'Lifecoach',
      publishedTime: post.publishedAt,
      tags: post.tags,
      images: [{ url: `${url}/opengraph-image`, width: 1200, height: 630, alt: post.title }],
    },
    twitter: {
      card: 'summary_large_image',
      title: post.title,
      description: post.description,
      images: [`${url}/opengraph-image`],
    },
  };
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const post = getBlogPost(slug);
  if (!post) notFound();

  const url = `${siteUrl}/blog/${post.slug}`;
  const articleSchema = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.description,
    datePublished: post.publishedAt,
    dateModified: post.publishedAt,
    author: { '@type': 'Organization', name: 'Lifecoach' },
    publisher: { '@type': 'Organization', name: 'Lifecoach' },
    mainEntityOfPage: url,
  };
  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
      { '@type': 'ListItem', position: 2, name: 'Blog', item: `${siteUrl}/blog` },
      { '@type': 'ListItem', position: 3, name: post.title, item: url },
    ],
  };
  const redditShareUrl = `https://www.reddit.com/${post.targetSubreddit.replace(
    'r/',
    'r/',
  )}/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(post.title)}`;

  return (
    <main className="min-h-screen bg-background px-5 py-6 sm:px-8 lg:px-12">
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD is generated from typed repository content for search engines.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleSchema) }}
      />
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD is generated from typed repository content for search engines.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }}
      />
      <nav className="mx-auto flex max-w-7xl items-center justify-between rounded-full border border-border/70 bg-background/75 px-4 py-3 shadow-sm backdrop-blur">
        <a href="/" className="font-serif text-2xl font-semibold tracking-tight text-foreground">
          Lifecoach
        </a>
        <a
          href="/blog"
          className="text-sm font-semibold text-muted-foreground hover:text-foreground"
        >
          Back to blog
        </a>
      </nav>

      <article className="mx-auto max-w-3xl pb-20 pt-16 lg:pt-24">
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full bg-accent/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-accent">
            {post.type}
          </span>
          <span className="rounded-full border border-border px-3 py-1 text-xs font-semibold text-muted-foreground">
            Target distribution: {post.targetSubreddit}
          </span>
        </div>
        <h1 className="mt-6 text-balance font-serif text-5xl font-semibold leading-[1.03] tracking-tight text-foreground sm:text-6xl">
          {post.title}
        </h1>
        <p className="mt-6 text-xl leading-9 text-muted-foreground">{post.description}</p>
        <div className="mt-6 flex flex-wrap gap-2">
          {post.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-[#fbf7ef] px-3 py-1 text-sm text-muted-foreground"
            >
              {tag}
            </span>
          ))}
        </div>

        <div className="prose prose-neutral mt-12 max-w-none">
          {post.body.map((section) => (
            <section key={section.heading} className="mt-10">
              <h2 className="font-serif text-3xl font-semibold text-foreground">
                {section.heading}
              </h2>
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph} className="mt-5 text-lg leading-9 text-muted-foreground">
                  {paragraph}
                </p>
              ))}
            </section>
          ))}
        </div>

        <aside className="mt-12 rounded-[2rem] border border-border bg-[#fbf7ef]/80 p-6">
          <h2 className="font-serif text-2xl font-semibold text-foreground">Share carefully</h2>
          <p className="mt-3 leading-7 text-muted-foreground">
            This post is tagged for {post.targetSubreddit}. Share only when it is allowed by the
            subreddit rules and useful as a standalone article, not as drive-by promotion.
          </p>
          <a
            href={redditShareUrl}
            className="mt-5 inline-flex rounded-full bg-foreground px-5 py-3 font-semibold text-background transition hover:-translate-y-0.5 hover:bg-accent"
          >
            Draft Reddit share
          </a>
        </aside>
      </article>
    </main>
  );
}
