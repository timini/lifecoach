import type { Metadata } from 'next';
import { featurePages } from '../../lib/marketing/feature-pages';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://tranquil.coach';

export const metadata: Metadata = {
  title: 'How tranquil.coach helps prevent overwhelm',
  description:
    'Focused AI coaching for the moments daily life starts to jam: overwhelm, ADHD task initiation, low motivation, anxious loops, wellness routines, career decisions, peri/menopause fog, or the inbox-calendar-task pile.',
  alternates: { canonical: `${siteUrl}/how-it-helps` },
};

export default function HowItHelpsIndexPage() {
  return (
    <main className="min-h-screen overflow-hidden bg-[linear-gradient(180deg,rgba(250,247,239,0.92)_0%,rgba(235,243,235,0.8)_48%,rgba(244,239,230,1)_100%)] px-5 py-6 sm:px-8 lg:px-12">
      <div className="absolute inset-x-0 top-0 -z-10 h-[520px] bg-[radial-gradient(circle_at_24%_12%,rgba(111,155,130,0.26),transparent_35%),radial-gradient(circle_at_82%_8%,rgba(199,123,104,0.16),transparent_35%)]" />
      <nav className="mx-auto flex max-w-7xl items-center justify-between rounded-full border border-white/65 bg-background/70 px-4 py-3 shadow-sm backdrop-blur-xl">
        <a
          href="/"
          className="flex items-center gap-3 text-foreground"
          aria-label="tranquil.coach home"
        >
          <span className="grid h-9 w-9 place-items-center rounded-full bg-foreground text-lg text-background">
            ◐
          </span>
          <span className="font-serif text-2xl font-semibold tracking-tight">tranquil.coach</span>
        </a>
        <a
          href="/chat"
          className="rounded-full bg-foreground px-5 py-2.5 text-sm font-semibold text-background shadow-sm transition hover:-translate-y-0.5 hover:bg-accent"
        >
          Begin softly
        </a>
      </nav>
      <section className="mx-auto max-w-5xl pb-14 pt-16 lg:pt-24">
        <p className="inline-flex rounded-full border border-white/70 bg-white/50 px-4 py-2 text-sm font-semibold text-foreground shadow-sm backdrop-blur">
          Choose your doorway
        </p>
        <h1 className="mt-6 text-balance font-serif text-5xl font-semibold leading-[1.03] tracking-tight text-foreground sm:text-7xl">
          Focused support for the moments daily life starts to jam.
        </h1>
        <p className="mt-6 max-w-3xl text-xl leading-9 text-muted-foreground">
          Every page is a calmer entry point into the same product: practical, context-aware AI
          coaching for the fuzzy middle between therapy, productivity apps, and a real human
          assistant.
        </p>
      </section>
      <section className="mx-auto grid max-w-7xl gap-5 pb-20 md:grid-cols-2 xl:grid-cols-4">
        {featurePages.map((page, index) => (
          <a
            key={page.topic}
            href={`/how-it-helps/${page.topic}`}
            className="rounded-[2rem] border border-white/65 bg-white/45 p-6 shadow-sm backdrop-blur transition hover:-translate-y-1 hover:border-accent hover:shadow-xl hover:shadow-foreground/10"
          >
            <p className="font-serif text-4xl font-semibold text-accent">
              {String(index + 1).padStart(2, '0')}
            </p>
            <p className="mt-4 text-xs font-bold uppercase tracking-[0.18em] text-accent">
              {page.keyphrases[0]}
            </p>
            <h2 className="mt-4 font-serif text-2xl font-semibold leading-tight text-foreground">
              {page.title}
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">{page.description}</p>
          </a>
        ))}
      </section>
    </main>
  );
}
