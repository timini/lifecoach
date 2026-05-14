import type { Metadata } from 'next';
import { featurePages } from '../../lib/marketing/feature-pages';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://tranquil.coach';

export const metadata: Metadata = {
  title: 'How tranquil.coach helps prevent overwhelm',
  description:
    'Focused support for the moments daily life starts to jam: overwhelm, ADHD task initiation, low motivation, anxious loops, wellness routines, career decisions, peri/menopause fog, or the inbox-calendar-task pile.',
  alternates: { canonical: `${siteUrl}/how-it-helps` },
};

export default function HowItHelpsIndexPage() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#f7f1e8] px-5 py-6 text-[#20342d] sm:px-8 lg:px-12">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_18%_12%,rgba(116,159,138,0.32),transparent_30%),radial-gradient(circle_at_86%_18%,rgba(239,181,140,0.28),transparent_30%),linear-gradient(135deg,#f7f1e8,#eef4e9_48%,#f9e3d8)]" />
      <nav className="mx-auto flex max-w-7xl items-center justify-between rounded-full border border-white/70 bg-white/55 px-4 py-3 shadow-sm backdrop-blur-xl">
        <a href="/" className="font-serif text-2xl font-semibold tracking-tight text-[#20342d]">
          tranquil.coach
        </a>
        <a
          href="/chat"
          className="rounded-full bg-[#20342d] px-5 py-2.5 text-sm font-semibold text-[#fffaf1] shadow-sm transition hover:-translate-y-0.5 hover:bg-[#5e8b76]"
        >
          Start coaching
        </a>
      </nav>
      <section className="mx-auto grid max-w-7xl gap-10 pb-14 pt-16 lg:grid-cols-[0.95fr_1.05fr] lg:items-end lg:pt-24">
        <div>
          <p className="inline-flex rounded-full border border-[#749f8a]/30 bg-white/50 px-4 py-2 text-sm font-semibold text-[#385f50] backdrop-blur">
            How it helps
          </p>
          <h1 className="mt-6 text-balance font-serif text-5xl font-semibold leading-[0.98] tracking-tight text-[#182d26] sm:text-7xl">
            Eight doors into one calmer operating system.
          </h1>
        </div>
        <p className="max-w-3xl text-xl leading-9 text-[#637168]">
          Pick the door that matches today’s stuckness. Every page leads to the same product
          promise: less shame, more context, and one small move you can actually make.
        </p>
      </section>
      <section className="mx-auto grid max-w-7xl gap-5 pb-20 md:grid-cols-2 xl:grid-cols-4">
        {featurePages.map((page, index) => (
          <a
            key={page.topic}
            href={`/how-it-helps/${page.topic}`}
            className="group relative overflow-hidden rounded-[2rem] border border-white/70 bg-white/55 p-6 shadow-sm backdrop-blur transition hover:-translate-y-1 hover:shadow-xl hover:shadow-[#20342d]/10"
          >
            <span className="absolute right-5 top-5 font-serif text-6xl font-semibold text-[#20342d]/5">
              {String(index + 1).padStart(2, '0')}
            </span>
            <div className="mb-10 h-2 w-20 rounded-full bg-gradient-to-r from-[#749f8a] to-[#efb58c]" />
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#5e8b76]">
              {page.keyphrases[0]}
            </p>
            <h2 className="mt-4 font-serif text-2xl font-semibold leading-tight text-[#20342d]">
              {page.title}
            </h2>
            <p className="mt-3 text-sm leading-6 text-[#68756e]">{page.description}</p>
            <span className="mt-6 inline-flex text-sm font-bold text-[#5e8b76] transition group-hover:translate-x-1">
              Enter this room →
            </span>
          </a>
        ))}
      </section>
    </main>
  );
}
