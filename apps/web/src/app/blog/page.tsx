import type { Metadata } from 'next';
import { absoluteUrl, blogPosts, featureTopics } from '../../content/marketing';

export const metadata: Metadata = {
  title: 'Lifecoach blog — overwhelm, ADHD, depression, and daily admin',
  description:
    'Evidence-backed and lived-experience writing about AI coaching, executive function, overwhelm, and practical daily support.',
  alternates: { canonical: absoluteUrl('/blog') },
  openGraph: {
    title: 'Lifecoach blog',
    description: 'Evidence-backed and personal-story posts about preventing overwhelm.',
    url: absoluteUrl('/blog'),
    type: 'website',
    images: [{ url: absoluteUrl('/og/blog'), width: 1200, height: 630, alt: 'Lifecoach blog' }],
  },
};

export default function BlogIndexPage() {
  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: absoluteUrl('/') },
      { '@type': 'ListItem', position: 2, name: 'Blog', item: absoluteUrl('/blog') },
    ],
  };

  return (
    <main className="min-h-screen overflow-hidden">
      <script type="application/ld+json">{JSON.stringify(breadcrumbSchema)}</script>
      <section className="relative px-5 py-6 sm:px-8 lg:px-12">
        <div className="absolute inset-x-0 top-0 -z-10 h-[520px] bg-[radial-gradient(circle_at_18%_15%,rgba(123,154,134,0.24),transparent_34%),radial-gradient(circle_at_80%_8%,rgba(198,123,99,0.17),transparent_34%)]" />
        <nav className="mx-auto flex max-w-7xl items-center justify-between rounded-full border border-border/70 bg-background/75 px-4 py-3 shadow-sm backdrop-blur">
          <a href="/" className="font-serif text-2xl font-semibold tracking-tight text-foreground">
            Lifecoach
          </a>
          <div className="hidden items-center gap-6 text-sm font-medium text-muted-foreground md:flex">
            {featureTopics.slice(0, 4).map((topic) => (
              <a
                key={topic.slug}
                href={`/how-it-helps/${topic.slug}`}
                className="transition hover:text-foreground"
              >
                {topic.eyebrow}
              </a>
            ))}
          </div>
          <a
            href="/chat"
            className="rounded-full bg-foreground px-5 py-2.5 text-sm font-semibold text-background shadow-sm transition hover:-translate-y-0.5 hover:bg-accent"
          >
            Start coaching
          </a>
        </nav>

        <div className="mx-auto max-w-5xl pb-14 pt-16 text-center lg:pb-20 lg:pt-24">
          <p className="mb-5 inline-flex rounded-full border border-accent/30 bg-accent/10 px-4 py-2 text-sm font-semibold text-foreground">
            Evidence, lived experience, and practical scripts
          </p>
          <h1 className="text-balance font-serif text-5xl font-semibold leading-[1.02] tracking-tight text-foreground sm:text-6xl">
            Writing for people whose daily admin is the bottleneck.
          </h1>
          <p className="mx-auto mt-6 max-w-3xl text-pretty text-lg leading-8 text-muted-foreground sm:text-xl">
            Research notes and honest field guides for ADHD, depression, anxiety, burnout, fog, and
            the messy middle between productivity apps and therapy.
          </p>
        </div>
      </section>

      <section className="px-5 pb-20 sm:px-8 lg:px-12">
        <div className="mx-auto grid max-w-7xl gap-5 md:grid-cols-3">
          {blogPosts.map((post) => (
            <article
              key={post.slug}
              className="flex min-h-full flex-col rounded-[2rem] border border-border bg-background/80 p-6 shadow-sm"
            >
              <div className="flex items-center justify-between gap-3 text-xs font-semibold uppercase tracking-[0.18em] text-accent">
                <span>{post.type}</span>
                <span>{post.targetSubreddit}</span>
              </div>
              <h2 className="mt-5 font-serif text-3xl font-semibold leading-tight">
                <a href={`/blog/${post.slug}`} className="transition hover:text-accent">
                  {post.title}
                </a>
              </h2>
              <p className="mt-4 flex-1 leading-7 text-muted-foreground">{post.description}</p>
              <div className="mt-6 flex flex-wrap gap-2">
                {post.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-border bg-muted/60 px-3 py-1 text-xs font-semibold text-foreground"
                  >
                    {tag}
                  </span>
                ))}
              </div>
              <a
                href={`/blog/${post.slug}`}
                className="mt-7 inline-flex font-semibold text-foreground transition hover:text-accent"
              >
                Read post →
              </a>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
