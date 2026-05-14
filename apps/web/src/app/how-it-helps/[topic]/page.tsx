import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { featurePages, getFeaturePage } from '../../../lib/marketing/feature-pages';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://tranquil.coach';

type FeaturePageProps = {
  params: Promise<{ topic: string }>;
};

export function generateStaticParams() {
  return featurePages.map((page) => ({ topic: page.topic }));
}

export async function generateMetadata({ params }: FeaturePageProps): Promise<Metadata> {
  const { topic } = await params;
  const page = getFeaturePage(topic);
  if (!page) {
    return {};
  }

  const path = `/how-it-helps/${page.topic}`;
  return {
    title: page.metaTitle,
    description: page.description,
    alternates: { canonical: path },
    keywords: page.keyphrases,
    openGraph: {
      title: page.h1,
      description: page.description,
      url: path,
      type: 'website',
      images: [{ url: `${path}/opengraph-image`, width: 1200, height: 630, alt: page.title }],
    },
  };
}

export default async function FeatureTopicPage({ params }: FeaturePageProps) {
  const { topic } = await params;
  const page = getFeaturePage(topic);
  if (!page) {
    notFound();
  }

  const pageUrl = `${siteUrl}/how-it-helps/${page.topic}`;
  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: page.faq.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: item.answer },
    })),
  };
  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
      { '@type': 'ListItem', position: 2, name: 'How it helps', item: `${siteUrl}/how-it-helps` },
      { '@type': 'ListItem', position: 3, name: page.title, item: pageUrl },
    ],
  };

  return (
    <main className="min-h-screen overflow-hidden bg-[#f7efe3] text-foreground">
      <script type="application/ld+json">{JSON.stringify(faqJsonLd)}</script>
      <script type="application/ld+json">{JSON.stringify(breadcrumbJsonLd)}</script>
      <section className="relative px-5 py-5 sm:px-8 lg:px-12">
        <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
          <div className="absolute left-[-8rem] top-[-5rem] h-96 w-96 rounded-full bg-[#f2b09d]/40 blur-3xl" />
          <div className="absolute right-[-7rem] top-32 h-[30rem] w-[30rem] rounded-full bg-[#a8cbb3]/55 blur-3xl" />
          <div className="absolute left-1/3 top-[34rem] h-72 w-72 rounded-full bg-[#f4d690]/35 blur-3xl" />
        </div>
        <nav className="mx-auto flex max-w-7xl items-center justify-between rounded-full border border-white/70 bg-white/45 px-4 py-3 shadow-sm backdrop-blur-xl">
          <a href="/" className="font-serif text-2xl font-semibold tracking-tight text-foreground">
            tranquil.coach
          </a>
          <div className="hidden items-center gap-6 text-sm font-semibold text-[#647168] md:flex">
            <a href="/how-it-helps" className="transition hover:text-foreground">
              Rooms
            </a>
            <a href="/blog" className="transition hover:text-foreground">
              Blog
            </a>
            <a href="/#privacy" className="transition hover:text-foreground">
              Trust
            </a>
          </div>
          <a
            href={`/chat?prompt=${encodeURIComponent(page.ctaPrompt)}`}
            className="rounded-full bg-[#24362d] px-5 py-2.5 text-sm font-semibold text-[#fff8ec] shadow-sm transition hover:-translate-y-0.5 hover:bg-[#7c6552]"
          >
            Start here
          </a>
        </nav>

        <div className="mx-auto grid max-w-7xl gap-10 pb-14 pt-16 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:pb-20 lg:pt-24">
          <div>
            <p className="mb-5 inline-flex rounded-full border border-white/70 bg-white/45 px-4 py-2 text-sm font-semibold text-foreground shadow-sm backdrop-blur-xl">
              {page.eyebrow}
            </p>
            <h1 className="max-w-5xl text-balance font-serif text-6xl font-semibold leading-[0.92] tracking-tight text-foreground sm:text-7xl lg:text-8xl">
              {page.h1}
            </h1>
            <p className="mt-7 max-w-2xl text-pretty text-lg leading-8 text-[#59665d] sm:text-xl">
              {page.opener}
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <a
                href={`/chat?prompt=${encodeURIComponent(page.ctaPrompt)}`}
                className="inline-flex items-center justify-center rounded-full bg-[#24362d] px-7 py-4 text-base font-semibold text-[#fff8ec] shadow-2xl shadow-[#24362d]/20 transition hover:-translate-y-0.5 hover:bg-[#7c6552]"
              >
                Start this conversation
              </a>
              <a
                href="/how-it-helps"
                className="inline-flex items-center justify-center rounded-full border border-white/70 bg-white/45 px-7 py-4 text-base font-semibold text-foreground shadow-sm backdrop-blur-xl transition hover:-translate-y-0.5 hover:border-[#d98f79]"
              >
                Explore all rooms
              </a>
            </div>
          </div>

          <aside className="relative rounded-[2.5rem] border border-white/70 bg-[#fffaf1]/75 p-6 shadow-2xl shadow-[#24362d]/12 backdrop-blur-xl">
            <div className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-[#f2b09d]/55 blur-2xl" />
            <p className="relative text-sm font-bold uppercase tracking-[0.22em] text-[#c87761]">
              The first prompt
            </p>
            <div className="relative mt-5 rounded-[2rem] border border-[#ead9c8] bg-white/55 p-5">
              <p className="font-serif text-3xl font-semibold leading-tight">“{page.ctaPrompt}”</p>
              <p className="mt-4 text-sm leading-7 text-[#647168]">
                Built for: <span className="font-semibold text-foreground">{page.audience}</span>
              </p>
            </div>
            <p className="relative mt-6 text-sm font-bold uppercase tracking-[0.22em] text-[#c87761]">
              Search language it answers
            </p>
            <ul className="relative mt-4 flex flex-wrap gap-2">
              {page.keyphrases.map((phrase) => (
                <li
                  key={phrase}
                  className="rounded-full border border-[#ead9c8] bg-white/55 px-4 py-2 text-sm font-semibold text-foreground"
                >
                  {phrase}
                </li>
              ))}
            </ul>
          </aside>
        </div>
      </section>

      <section className="px-5 py-14 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-7xl">
          <div className="max-w-3xl">
            <p className="text-sm font-bold uppercase tracking-[0.24em] text-[#c87761]">
              Concrete ways to use it
            </p>
            <h2 className="mt-3 font-serif text-5xl font-semibold leading-[0.98] sm:text-6xl">
              Start where the stuckness actually lives.
            </h2>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-2">
            {page.useCases.map((useCase, index) => (
              <article
                key={useCase}
                className="rounded-[2rem] border border-white/70 bg-[#fffaf1]/70 p-7 shadow-sm"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#24362d] text-sm font-bold text-[#fff8ec]">
                  {index + 1}
                </span>
                <p className="mt-5 text-lg font-medium leading-8 text-foreground">{useCase}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="px-5 py-14 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-5xl rounded-[3rem] border border-white/70 bg-white/40 p-8 shadow-sm backdrop-blur-xl sm:p-10">
          <p className="text-sm font-bold uppercase tracking-[0.24em] text-[#c87761]">FAQ</p>
          <div className="mt-6 grid gap-4">
            {page.faq.map((item) => (
              <details
                key={item.question}
                className="rounded-[1.7rem] border border-white/70 bg-[#fffaf1]/75 p-5"
              >
                <summary className="cursor-pointer font-serif text-2xl font-semibold text-foreground">
                  {item.question}
                </summary>
                <p className="mt-3 leading-7 text-[#647168]">{item.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
