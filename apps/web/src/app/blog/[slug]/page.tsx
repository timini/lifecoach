import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { absoluteUrl, blogPosts, getBlogPost } from '../../../content/marketing';

export function generateStaticParams() {
  return blogPosts.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = getBlogPost(slug);

  if (!post) {
    return {};
  }

  const url = absoluteUrl(`/blog/${post.slug}`);
  const image = absoluteUrl(`/og/blog/${post.slug}`);

  return {
    title: `${post.title} | Lifecoach`,
    description: post.description,
    alternates: { canonical: url },
    openGraph: {
      title: post.title,
      description: post.description,
      url,
      type: 'article',
      publishedTime: post.publishedAt,
      tags: post.tags,
      images: [{ url: image, width: 1200, height: 630, alt: post.title }],
    },
    twitter: {
      card: 'summary_large_image',
      title: post.title,
      description: post.description,
      images: [image],
    },
  };
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getBlogPost(slug);

  if (!post) {
    notFound();
  }

  const articleSchema = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.description,
    datePublished: post.publishedAt,
    dateModified: post.publishedAt,
    author: { '@type': 'Organization', name: 'Lifecoach' },
    publisher: { '@type': 'Organization', name: 'Lifecoach' },
    mainEntityOfPage: absoluteUrl(`/blog/${post.slug}`),
    image: absoluteUrl(`/og/blog/${post.slug}`),
    keywords: post.tags.join(', '),
  };

  const breadcrumbSchema = {
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

  const shareUrl = `https://www.reddit.com/r/${post.targetSubreddit.replace('r/', '')}/submit?${new URLSearchParams(
    {
      url: absoluteUrl(`/blog/${post.slug}`),
      title: post.title,
    },
  ).toString()}`;

  return (
    <main className="min-h-screen overflow-hidden">
      <script type="application/ld+json">{JSON.stringify(articleSchema)}</script>
      <script type="application/ld+json">{JSON.stringify(breadcrumbSchema)}</script>
      <article className="px-5 py-6 sm:px-8 lg:px-12">
        <nav className="mx-auto flex max-w-5xl items-center justify-between rounded-full border border-border/70 bg-background/75 px-4 py-3 shadow-sm backdrop-blur">
          <a href="/" className="font-serif text-2xl font-semibold tracking-tight text-foreground">
            Lifecoach
          </a>
          <a
            href="/blog"
            className="text-sm font-semibold text-muted-foreground transition hover:text-foreground"
          >
            Blog
          </a>
        </nav>

        <header className="mx-auto max-w-4xl pb-12 pt-16 text-center">
          <p className="mb-5 inline-flex rounded-full border border-accent/30 bg-accent/10 px-4 py-2 text-sm font-semibold text-foreground">
            {post.type} · Target distribution: {post.targetSubreddit}
          </p>
          <h1 className="text-balance font-serif text-5xl font-semibold leading-[1.04] tracking-tight text-foreground sm:text-6xl">
            {post.title}
          </h1>
          <p className="mx-auto mt-6 max-w-3xl text-pretty text-lg leading-8 text-muted-foreground sm:text-xl">
            {post.description}
          </p>
          <a
            href={shareUrl}
            className="mt-8 inline-flex items-center justify-center rounded-full border border-border bg-background/70 px-6 py-3 text-sm font-semibold text-foreground transition hover:-translate-y-0.5 hover:border-accent"
          >
            Share carefully to {post.targetSubreddit}
          </a>
        </header>

        <div className="mx-auto max-w-3xl rounded-[2rem] border border-border bg-background/80 p-7 shadow-sm sm:p-10">
          {post.sections.map((section) => (
            <section key={section.heading} className="mt-10 first:mt-0">
              <h2 className="font-serif text-3xl font-semibold leading-tight">{section.heading}</h2>
              <div className="mt-5 space-y-5 text-lg leading-8 text-muted-foreground">
                {section.body.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
            </section>
          ))}

          {post.citations ? (
            <section className="mt-10 rounded-[1.5rem] border border-border bg-muted/50 p-5">
              <h2 className="font-serif text-2xl font-semibold">Sources and further reading</h2>
              <ul className="mt-4 space-y-3 text-sm font-medium leading-6">
                {post.citations.map((citation) => (
                  <li key={citation.href}>
                    <a
                      href={citation.href}
                      className="text-foreground underline decoration-accent underline-offset-4"
                    >
                      {citation.label}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </article>
    </main>
  );
}
