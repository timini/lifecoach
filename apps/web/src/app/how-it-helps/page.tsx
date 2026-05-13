import type { Metadata } from 'next';
import { helpTopics, siteUrl } from '../../content/seo';

export const metadata: Metadata = {
  title: 'How Lifecoach helps prevent overwhelm',
  description:
    'Explore Lifecoach support pages for overwhelm, ADHD, depression, anxiety, wellness, career, menopause, and personal admin.',
  alternates: { canonical: `${siteUrl}/how-it-helps` },
};

export default function HowItHelpsIndexPage() {
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
          How it helps
        </p>
        <h1 className="mt-6 text-balance font-serif text-5xl font-semibold leading-[1.03] tracking-tight text-foreground sm:text-6xl">
          Focused support for the moments daily life starts to jam.
        </h1>
        <p className="mt-6 max-w-3xl text-xl leading-9 text-muted-foreground">
          Choose the page closest to what you are dealing with: overwhelm, ADHD task initiation, low
          motivation, anxious loops, wellness routines, career decisions, peri/menopause fog, or the
          inbox-calendar-task pile.
        </p>
      </section>
      <section className="mx-auto grid max-w-7xl gap-5 pb-20 md:grid-cols-2 xl:grid-cols-4">
        {helpTopics.map((topic) => (
          <a
            key={topic.slug}
            href={`/how-it-helps/${topic.slug}`}
            className="rounded-[2rem] border border-border bg-background/80 p-6 shadow-sm transition hover:-translate-y-1 hover:border-accent hover:shadow-xl hover:shadow-foreground/10"
          >
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-accent">
              {topic.keyphrases[0]}
            </p>
            <h2 className="mt-4 font-serif text-2xl font-semibold leading-tight text-foreground">
              {topic.title}
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">{topic.description}</p>
          </a>
        ))}
      </section>
    </main>
  );
}
