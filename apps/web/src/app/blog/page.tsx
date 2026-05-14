import type { Metadata } from 'next';
import { formatPostDate, getBlogPosts } from '../../lib/marketing/blog';

export const metadata: Metadata = {
  title: 'tranquil.coach journal — AI support for overwhelm, ADHD, and daily admin',
  description:
    'Field notes for softer momentum about AI coaching, ADHD executive function, depression, burnout, and daily admin.',
  alternates: { canonical: '/blog' },
  openGraph: {
    title: 'tranquil.coach journal',
    description: 'Field notes for softer momentum about preventing overwhelm.',
    url: '/blog',
    type: 'website',
  },
};

export default function BlogIndexPage() {
  const posts = getBlogPosts();

  return (
    <main className="min-h-screen overflow-hidden px-5 py-6 sm:px-8 lg:px-12">
      <div className="absolute inset-x-0 top-0 -z-10 h-[520px] bg-[radial-gradient(circle_at_22%_15%,rgba(123,154,134,0.22),transparent_34%),radial-gradient(circle_at_85%_4%,rgba(198,123,99,0.16),transparent_34%)]" />
      <nav className="mx-auto flex max-w-7xl items-center justify-between rounded-full border border-white/65 bg-background/70 px-4 py-3 shadow-sm backdrop-blur">
        <a href="/" className="font-serif text-2xl font-semibold tracking-tight text-foreground">
          tranquil.coach
        </a>
        <a
          href="/chat"
          className="rounded-full bg-foreground px-5 py-2.5 text-sm font-semibold text-background shadow-sm transition hover:-translate-y-0.5 hover:bg-accent"
        >
          Begin softly
        </a>
      </nav>

      <section className="mx-auto max-w-7xl pb-12 pt-16 lg:pb-18 lg:pt-24">
        <p className="mb-5 inline-flex rounded-full border border-accent/30 bg-accent/10 px-4 py-2 text-sm font-semibold text-foreground">
          Field notes for softer momentum
        </p>
        <h1 className="max-w-5xl text-balance font-serif text-5xl font-semibold leading-[1.02] tracking-tight text-foreground sm:text-6xl lg:text-7xl">
          Notes from the fuzzy middle between intention and capacity.
        </h1>
        <p className="mt-6 max-w-3xl text-pretty text-lg leading-8 text-muted-foreground sm:text-xl">
          Practical essays for ADHD, depression, burnout, anxiety, and the fuzzy middle between
          therapy, productivity apps, and a real human assistant. Each post has a suggested Reddit
          community for careful, transparent distribution.
        </p>
      </section>

      <section className="mx-auto grid max-w-7xl gap-5 pb-20 md:grid-cols-3">
        {posts.map((post) => (
          <article
            key={post.slug}
            className="rounded-[2rem] border border-white/65 bg-white/45 backdrop-blur p-6 shadow-sm"
          >
            <div className="flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-accent">
              <span>{post.type.replace('-', ' ')}</span>
              <span>•</span>
              <span>{post.targetSubreddit}</span>
            </div>
            <h2 className="mt-4 font-serif text-3xl font-semibold leading-tight text-foreground">
              <a href={`/blog/${post.slug}`} className="transition hover:text-accent">
                {post.title}
              </a>
            </h2>
            <p className="mt-4 text-sm leading-7 text-muted-foreground">{post.description}</p>
            <p className="mt-5 text-sm font-semibold text-foreground">
              {formatPostDate(post.date)}
            </p>
          </article>
        ))}
      </section>
    </main>
  );
}
