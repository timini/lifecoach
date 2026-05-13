import { getBlogPost, getBlogPosts, getRedditShareUrl } from '@/lib/blog';
import { absoluteUrl } from '@/lib/marketing';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

type PageProps = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return getBlogPosts().map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = getBlogPost(slug);

  if (!post) {
    return {};
  }

  const url = absoluteUrl(`/blog/${post.slug}`);

  return {
    title: `${post.title} | Lifecoach`,
    description: post.description,
    alternates: { canonical: url },
    keywords: post.tags,
    openGraph: {
      title: post.title,
      description: post.description,
      url,
      type: 'article',
      publishedTime: post.date,
      tags: post.tags,
      images: [{ url: absoluteUrl('/og/overwhelm'), width: 1200, height: 630 }],
    },
    twitter: {
      card: 'summary_large_image',
      title: post.title,
      description: post.description,
      images: [absoluteUrl('/og/overwhelm')],
    },
  };
}

export default async function BlogPostPage({ params }: PageProps) {
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
    dateModified: post.date,
    author: { '@type': 'Organization', name: 'Lifecoach' },
    publisher: { '@type': 'Organization', name: 'Lifecoach' },
    mainEntityOfPage: absoluteUrl(`/blog/${post.slug}`),
  };
  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: absoluteUrl('/') },
      { '@type': 'ListItem', position: 2, name: 'Blog', item: absoluteUrl('/blog') },
      {
        '@type': 'ListItem',
        position: 3,
        name: post.title,
        item: absoluteUrl(`/blog/${post.slug}`),
      },
    ],
  };

  return (
    <main className="min-h-screen overflow-hidden">
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD is generated from typed local content.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }}
      />
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD is generated from typed local content.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      <article className="px-5 py-6 sm:px-8 lg:px-12">
        <nav className="mx-auto flex max-w-4xl items-center justify-between rounded-full border border-border/70 bg-background/75 px-4 py-3 shadow-sm backdrop-blur">
          <a href="/" className="font-serif text-2xl font-semibold tracking-tight text-foreground">
            Lifecoach
          </a>
          <a
            href="/blog"
            className="text-sm font-semibold text-muted-foreground hover:text-foreground"
          >
            All posts
          </a>
        </nav>

        <header className="mx-auto max-w-4xl pb-12 pt-16">
          <div className="flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-accent">
            <span>{post.type.replace('-', ' ')}</span>
            <span>•</span>
            <span>{post.targetSubreddit}</span>
          </div>
          <h1 className="mt-5 text-balance font-serif text-5xl font-semibold leading-[1.02] tracking-tight text-foreground sm:text-6xl">
            {post.title}
          </h1>
          <p className="mt-6 text-pretty text-lg leading-8 text-muted-foreground sm:text-xl">
            {post.description}
          </p>
          <a
            href={getRedditShareUrl(post)}
            className="mt-8 inline-flex items-center justify-center rounded-full bg-foreground px-6 py-3 text-sm font-semibold text-background shadow-lg shadow-foreground/10 transition hover:-translate-y-0.5 hover:bg-accent"
          >
            Share carefully to {post.targetSubreddit}
          </a>
        </header>

        <div className="mx-auto max-w-3xl rounded-[2rem] border border-border bg-background/80 p-7 shadow-sm sm:p-10">
          <MarkdownBody body={post.body} />
        </div>
      </article>
    </main>
  );
}

function MarkdownBody({ body }: { body: string }) {
  return (
    <div className="space-y-6">
      {body.split('\n\n').map((block) => {
        if (block.startsWith('## ')) {
          return (
            <h2 key={block} className="pt-4 font-serif text-3xl font-semibold leading-tight">
              {block.replace(/^## /, '')}
            </h2>
          );
        }

        return (
          <p key={block} className="text-base leading-8 text-muted-foreground">
            {block}
          </p>
        );
      })}
    </div>
  );
}
