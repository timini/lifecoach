import type { Metadata } from 'next';
import { featurePages } from '../../lib/marketing/feature-pages';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://tranquil.coach';

export const metadata: Metadata = {
  title: 'How tranquil.coach helps prevent overwhelm',
  description:
    'Focused support rooms for the moments daily life starts to jam: overwhelm, ADHD task initiation, low motivation, anxious loops, wellness routines, career decisions, peri/menopause fog, or the inbox-calendar-task pile.',
  alternates: { canonical: `${siteUrl}/how-it-helps` },
};

export default function HowItHelpsIndexPage() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#f7efe3] px-5 py-5 text-foreground sm:px-8 lg:px-12">
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute left-[-8rem] top-[-4rem] h-96 w-96 rounded-full bg-[#f2b09d]/40 blur-3xl" />
        <div className="absolute right-[-6rem] top-28 h-[28rem] w-[28rem] rounded-full bg-[#a8cbb3]/55 blur-3xl" />
      </div>
      <nav className="mx-auto flex max-w-7xl items-center justify-between rounded-full border border-white/70 bg-white/45 px-4 py-3 shadow-sm backdrop-blur-xl">
        <a href="/" className="font-serif text-2xl font-semibold tracking-tight text-foreground">
          tranquil.coach
        </a>
        <a
          href="/chat"
          className="rounded-full bg-[#24362d] px-5 py-2.5 text-sm font-semibold text-[#fff8ec] shadow-sm transition hover:-translate-y-0.5 hover:bg-[#7c6552]"
        >
          Start coaching
        </a>
      </nav>
      <section className="mx-auto grid max-w-7xl gap-10 pb-14 pt-16 lg:grid-cols-[0.9fr_1.1fr] lg:items-end lg:pt-24">
        <div>
          <p className="inline-flex rounded-full border border-white/70 bg-white/45 px-4 py-2 text-sm font-semibold text-foreground shadow-sm backdrop-blur-xl">
            How it helps
          </p>
          <h1 className="mt-6 text-balance font-serif text-6xl font-semibold leading-[0.94] tracking-tight text-foreground sm:text-7xl">
            Choose the room closest to the knot.
          </h1>
        </div>
        <p className="max-w-3xl text-xl leading-9 text-[#59665d]">
          tranquil.coach now opens through focused, emotionally precise landing rooms. Pick the one
          that sounds like your day — overwhelm, ADHD task initiation, low motivation, anxious
          loops, wellness routines, career decisions, peri/menopause fog, or the inbox-calendar-task
          pile.
        </p>
      </section>
      <section className="mx-auto grid max-w-7xl gap-5 pb-24 md:grid-cols-2 xl:grid-cols-4">
        {featurePages.map((page, index) => (
          <a
            key={page.topic}
            href={`/how-it-helps/${page.topic}`}
            className="group relative min-h-[300px] overflow-hidden rounded-[2.2rem] border border-white/70 bg-[#fffaf1]/70 p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-2xl hover:shadow-[#24362d]/10"
          >
            <div
              className={`absolute -right-12 -top-12 h-36 w-36 rounded-full blur-2xl ${cardGlow(index)}`}
            />
            <div className="relative flex h-full flex-col justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#c87761]">
                  {page.keyphrases[0]}
                </p>
                <h2 className="mt-5 font-serif text-3xl font-semibold leading-tight text-foreground">
                  {page.title}
                </h2>
                <p className="mt-4 text-sm leading-6 text-[#647168]">{page.description}</p>
              </div>
              <span className="mt-8 inline-flex text-sm font-bold text-foreground transition group-hover:translate-x-1">
                Enter this room →
              </span>
            </div>
          </a>
        ))}
      </section>
    </main>
  );
}

function cardGlow(index: number) {
  return ['bg-[#f2b09d]/55', 'bg-[#a8cbb3]/60', 'bg-[#f4d690]/55', 'bg-[#b7b4e8]/45'][index % 4];
}
