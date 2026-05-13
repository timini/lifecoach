import { getBlogPosts } from '@/lib/blog';
import { absoluteUrl } from '@/lib/marketing';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Lifecoach blog | Executive function, AI coaching, and daily admin',
  description:
    'Evidence-backed and lived-experience writing about ADHD, depression, overwhelm, behaviour change, and AI support for daily admin.',
  alternates: { canonical: absoluteUrl('/blog') },
  openGraph: {
    title: 'Lifecoach blog',
    description:
      'Evidence-backed and personal-story posts about AI support for daily follow-through.',
    url: absoluteUrl('/blog'),
    type: 'website',
  },
};

export default function BlogIndexPage() {
  const posts = getBlogPosts();

  return (
    <main className="min-h-screen overflow-hidden">
      <section className="relative px-5 py-6 sm:px-8 lg:px-12">
        <div className="absolute inset-x-0 top-0 -z-10 h-[520px] bg-[radial-gradient(circle_at_18%_12%,rgba(123,154,134,0.22),transparent_34%),radial-gradient(circle_at_78%_8%,rgba(198,123,99,0.16),transparent_34%)]" />
        <nav className="mx-auto flex max-w-7xl items-center justify-between rounded-full border border-border/70 bg-background/75 px-4 py-3 shadow-sm backdrop-blur">
          <a href="/" className="font-serif text-2xl font-semibold tracking-tight text-foreground">
            Lifecoach
          </a>
          <a
            href="/how-it-helps/overwhelm"
            className="rounded-full bg-foreground px-5 py-2.5 text-sm font-semibold text-background shadow-sm transition hover:-translate-y-0.5 hover:bg-accent"
          >
            How it helps
          </a>
        </nav>
        <div className="mx-auto max-w-5xl pb-16 pt-16 text-center lg:pb-24 lg:pt-24">
          <p className="mb-5 inline-flex rounded-full border border-accent/30 bg-accent/10 px-4 py-2 text-sm font-semibold text-foreground">
            Evidence-backed and lived-experience posts
          </p>
          <h1 className="text-balance font-serif text-5xl font-semibold leading-[1.02] tracking-tight text-foreground sm:text-6xl lg:text-7xl">
            Writing about executive function, overwhelm, and AI coaching.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-pretty text-lg leading-8 text-muted-foreground sm:text-xl">
            Useful posts for people whose daily admin is the bottleneck, with transparent Reddit
            distribution targets on every article.
          </p>
        </div>
      </section>

      <section className="px-5 pb-20 sm:px-8 lg:px-12">
        <div className="mx-auto grid max-w-7xl gap-5 md:grid-cols-3">
          {posts.map((post) => (
            <article
              key={post.slug}
              className="flex flex-col rounded-[2rem] border border-border bg-background/80 p-7 shadow-sm"
            >
              <div className="flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-accent">
                <span>{post.type.replace('-', ' ')}</span>
                <span>•</span>
                <span>{post.targetSubreddit}</span>
              </div>
              <h2 className="mt-5 font-serif text-3xl font-semibold leading-tight text-foreground">
                <a href={`/blog/${post.slug}`} className="transition hover:text-accent">
                  {post.title}
                </a>
              </h2>
              <p className="mt-4 flex-1 text-sm leading-7 text-muted-foreground">
                {post.description}
              </p>
              <a
                href={`/blog/${post.slug}`}
                className="mt-6 inline-flex text-sm font-semibold text-foreground transition hover:text-accent"
              >
                Read article →
              </a>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
