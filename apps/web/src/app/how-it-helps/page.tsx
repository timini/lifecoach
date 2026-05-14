import type { Metadata } from 'next';
import { featurePages } from '../../lib/marketing/feature-pages';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://tranquil.coach';

export const metadata: Metadata = {
  title: 'How Tranquil helps prevent overwhelm',
  description:
    'Focused AI coaching for the moments daily life starts to jam: overwhelm, ADHD task initiation, low motivation, anxious loops, wellness routines, career decisions, peri/menopause fog, or the inbox-calendar-task pile.',
  alternates: { canonical: `${siteUrl}/how-it-helps` },
};

const moods = ['overwhelm', 'initiation', 'energy', 'rumination', 'wellness', 'direction'];

export default function HowItHelpsIndexPage() {
  // Index page exists primarily so the breadcrumb JSON-LD on each
  // `/how-it-helps/[topic]` page resolves to a real URL (its second
  // crumb), and to give crawlers a single hub link they can use to
  // discover every feature page. The visual list also doubles as
  // navigation when a visitor lands on one topic and wants to scan
  // siblings.
  return (
    <main className="min-h-screen overflow-hidden bg-[#f7f0e6] px-5 py-6 sm:px-8 lg:px-12">
      <div className="absolute inset-x-0 top-0 -z-10 h-[40rem] bg-[radial-gradient(circle_at_18%_16%,rgba(128,100,210,0.18),transparent_30%),radial-gradient(circle_at_84%_10%,rgba(72,151,130,0.2),transparent_32%)]" />
      <nav className="mx-auto flex max-w-7xl items-center justify-between rounded-full border border-white/70 bg-white/55 px-4 py-3 shadow-[0_20px_80px_rgba(47,59,52,0.08)] backdrop-blur-xl">
        <a href="/" className="flex items-center gap-3 text-foreground">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-foreground text-lg text-background">
            ◒
          </span>
          <span className="font-serif text-2xl font-semibold tracking-tight">tranquil.coach</span>
        </a>
        <a
          href="/chat"
          className="rounded-full bg-foreground px-5 py-2.5 text-sm font-semibold text-background shadow-sm transition hover:-translate-y-0.5 hover:bg-accent"
        >
          Begin gently
        </a>
      </nav>

      <section className="mx-auto grid max-w-7xl gap-10 pb-14 pt-16 lg:grid-cols-[0.92fr_1.08fr] lg:items-end lg:pt-24">
        <div>
          <p className="inline-flex rounded-full border border-white/70 bg-white/55 px-4 py-2 text-sm font-bold text-foreground shadow-sm backdrop-blur">
            How Tranquil helps
          </p>
          <h1 className="mt-6 text-balance font-serif text-6xl font-semibold leading-[0.98] tracking-[-0.04em] text-foreground sm:text-7xl">
            Pick the shape of stuck.
          </h1>
          <p className="mt-6 max-w-3xl text-xl leading-9 text-muted-foreground">
            Every doorway opens into the same calm coach, tuned to the moment you are actually in:
            overwhelm, ADHD task initiation, low motivation, anxious loops, wellness routines,
            career decisions, peri/menopause fog, or the inbox-calendar-task pile.
          </p>
        </div>
        <div className="rounded-[2.5rem] border border-white/70 bg-white/45 p-5 shadow-xl shadow-foreground/10 backdrop-blur">
          <p className="text-sm font-bold uppercase tracking-[0.24em] text-accent">mood map</p>
          <div className="mt-5 flex flex-wrap gap-3">
            {moods.map((mood) => (
              <span
                key={mood}
                className="rounded-full border border-border/70 bg-[#fcf8f1] px-4 py-2 text-sm font-bold text-foreground"
              >
                {mood}
              </span>
            ))}
          </div>
          <p className="mt-6 rounded-[1.75rem] bg-foreground p-5 text-sm leading-7 text-background/75">
            Tranquil does not ask you to choose a system. It asks what is heavy, names the next
            humane move, and helps you leave a breadcrumb for later.
          </p>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-5 pb-24 md:grid-cols-2 xl:grid-cols-4">
        {featurePages.map((page, index) => (
          <a
            key={page.topic}
            href={`/how-it-helps/${page.topic}`}
            className="group relative min-h-72 overflow-hidden rounded-[2.25rem] border border-white/70 bg-white/50 p-6 shadow-sm backdrop-blur transition hover:-translate-y-1 hover:shadow-xl hover:shadow-foreground/10"
          >
            <span className="absolute -right-2 -top-4 font-serif text-8xl text-accent/10 transition group-hover:scale-110">
              {String(index + 1).padStart(2, '0')}
            </span>
            <p className="relative max-w-[80%] text-xs font-bold uppercase tracking-[0.18em] text-accent">
              {page.keyphrases[0]}
            </p>
            <h2 className="relative mt-8 font-serif text-3xl font-semibold leading-tight text-foreground">
              {page.title}
            </h2>
            <p className="relative mt-4 text-sm leading-6 text-muted-foreground">
              {page.description}
            </p>
            <span className="relative mt-7 inline-flex text-sm font-bold text-foreground transition group-hover:translate-x-1">
              Enter this path →
            </span>
          </a>
        ))}
      </section>
    </main>
  );
}
