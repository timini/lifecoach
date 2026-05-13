import type { Metadata } from 'next';
import { blogPosts, siteUrl } from '../../content/seo';

export const metadata: Metadata = {
  title: 'Lifecoach blog — executive function, overwhelm, and AI coaching',
  description:
    'Evidence-backed and personal-story articles about ADHD, depression, overwhelm, daily admin, and practical AI coaching.',
  alternates: { canonical: `${siteUrl}/blog` },
  openGraph: {
    title: 'Lifecoach blog',
    description: 'Practical writing on executive function, overwhelm, and AI coaching.',
    url: `${siteUrl}/blog`,
    siteName: 'Lifecoach',
  },
};

export default function BlogIndexPage() {
  return (
    <main className="min-h-screen bg-background px-5 py-6 sm:px-8 lg:px-12">
      <nav className="mx-auto flex max-w-7xl items-center justify-between rounded-full border border-border/70 bg-background/75 px-4 py-3 shadow-sm backdrop-blur">
        <a href="/" className="font-serif text-2xl font-semibold tracking-tight text-foreground">
          Lifecoach
        </a>
        <a
          href="/chat"
          className="rounded-full bg-foreground px-5 py-2.5 text-sm font-semibold text-background shadow-sm transition hover:-translate-y-0.5 hover:bg-accent"
        >
          Start coaching
        </a>
      </nav>

      <section className="mx-auto max-w-5xl pb-14 pt-16 lg:pt-24">
        <p className="inline-flex rounded-full border border-accent/30 bg-accent/10 px-4 py-2 text-sm font-semibold text-foreground">
          Blog
        </p>
        <h1 className="mt-6 text-balance font-serif text-5xl font-semibold leading-[1.03] tracking-tight text-foreground sm:text-6xl">
          Evidence, lived experience, and practical ways to prevent overwhelm.
        </h1>
        <p className="mt-6 max-w-3xl text-xl leading-9 text-muted-foreground">
          Articles designed for careful Reddit-led distribution: useful first, transparent about the
          product, and grounded in the daily admin problems people actually search for.
        </p>
      </section>

      <section className="mx-auto grid max-w-7xl gap-5 pb-20 lg:grid-cols-3">
        {blogPosts.map((post) => (
          <article
            key={post.slug}
            className="flex flex-col rounded-[2rem] border border-border bg-background/80 p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-xl hover:shadow-foreground/10"
          >
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-accent/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-accent">
                {post.type}
              </span>
              <span className="rounded-full border border-border px-3 py-1 text-xs font-semibold text-muted-foreground">
                {post.targetSubreddit}
              </span>
            </div>
            <h2 className="mt-5 font-serif text-3xl font-semibold leading-tight text-foreground">
              <a href={`/blog/${post.slug}`}>{post.title}</a>
            </h2>
            <p className="mt-4 flex-1 leading-7 text-muted-foreground">{post.description}</p>
            <a href={`/blog/${post.slug}`} className="mt-6 font-semibold text-foreground">
              Read article →
            </a>
          </article>
        ))}
      </section>
    </main>
  );
}
