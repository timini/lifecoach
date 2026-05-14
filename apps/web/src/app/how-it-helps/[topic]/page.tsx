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

  const siblingPages = featurePages.filter((item) => item.topic !== page.topic).slice(0, 3);
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
    <main className="min-h-screen overflow-hidden bg-[#f7f1e8] text-[#20342d]">
      <script type="application/ld+json">{JSON.stringify(faqJsonLd)}</script>
      <script type="application/ld+json">{JSON.stringify(breadcrumbJsonLd)}</script>
      <section className="relative px-5 py-6 sm:px-8 lg:px-12">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_20%_18%,rgba(116,159,138,0.34),transparent_30%),radial-gradient(circle_at_82%_8%,rgba(239,181,140,0.28),transparent_30%),linear-gradient(135deg,#f7f1e8,#eef4e9_48%,#f9e3d8)]" />
        <nav className="mx-auto flex max-w-7xl items-center justify-between rounded-full border border-white/70 bg-white/55 px-4 py-3 shadow-sm backdrop-blur-xl">
          <a href="/" className="font-serif text-2xl font-semibold tracking-tight text-[#20342d]">
            tranquil.coach
          </a>
          <div className="hidden items-center gap-6 text-sm font-medium text-[#637168] md:flex">
            <a href="/how-it-helps" className="transition hover:text-[#20342d]">
              All rooms
            </a>
            <a href="/blog" className="transition hover:text-[#20342d]">
              Blog
            </a>
            <a href="/#privacy" className="transition hover:text-[#20342d]">
              Privacy
            </a>
          </div>
          <a
            href={`/chat?prompt=${encodeURIComponent(page.ctaPrompt)}`}
            className="rounded-full bg-[#20342d] px-5 py-2.5 text-sm font-semibold text-[#fffaf1] shadow-sm transition hover:-translate-y-0.5 hover:bg-[#5e8b76]"
          >
            Start here
          </a>
        </nav>

        <div className="mx-auto grid max-w-7xl gap-10 pb-14 pt-16 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:pb-20 lg:pt-24">
          <div>
            <p className="mb-5 inline-flex rounded-full border border-[#749f8a]/30 bg-white/50 px-4 py-2 text-sm font-semibold text-[#385f50] shadow-sm backdrop-blur">
              {page.eyebrow}
            </p>
            <h1 className="max-w-4xl text-balance font-serif text-5xl font-semibold leading-[0.98] tracking-tight text-[#182d26] sm:text-6xl lg:text-7xl">
              {page.h1}
            </h1>
            <p className="mt-6 max-w-2xl text-pretty text-lg leading-8 text-[#637168] sm:text-xl">
              {page.opener}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a
                href={`/chat?prompt=${encodeURIComponent(page.ctaPrompt)}`}
                className="inline-flex items-center justify-center rounded-full bg-[#20342d] px-7 py-4 text-base font-semibold text-[#fffaf1] shadow-lg shadow-[#20342d]/10 transition hover:-translate-y-0.5 hover:bg-[#5e8b76]"
              >
                Start this conversation
              </a>
              <a
                href="/how-it-helps"
                className="inline-flex items-center justify-center rounded-full border border-white/70 bg-white/55 px-7 py-4 text-base font-semibold text-[#20342d] shadow-sm backdrop-blur transition hover:-translate-y-0.5 hover:border-[#749f8a]"
              >
                Explore every room
              </a>
            </div>
          </div>

          <aside className="relative overflow-hidden rounded-[2.4rem] border border-white/70 bg-white/55 p-6 shadow-2xl shadow-[#20342d]/15 backdrop-blur-xl">
            <div className="absolute -right-16 -top-16 h-44 w-44 rounded-full bg-[#efb58c]/35 blur-2xl" />
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-[#5e8b76]">
              Room card
            </p>
            <div className="mt-5 rounded-[1.75rem] bg-[#20342d] p-5 text-[#fffaf1]">
              <p className="text-sm text-[#d8e5dd]">Built for</p>
              <p className="mt-2 font-serif text-3xl font-semibold leading-tight">
                {page.audience}
              </p>
            </div>
            <ul className="mt-5 grid gap-3">
              {page.keyphrases.map((phrase) => (
                <li
                  key={phrase}
                  className="rounded-2xl border border-white/80 bg-[#fffaf1]/80 px-4 py-3 text-sm font-semibold text-[#20342d]"
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
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[#5e8b76]">
              Concrete ways to use it
            </p>
            <h2 className="mt-3 font-serif text-4xl font-semibold leading-tight sm:text-5xl">
              Use cases that start where the stuckness actually is.
            </h2>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-2">
            {page.useCases.map((useCase, index) => (
              <article
                key={useCase}
                className="rounded-[2rem] border border-white/70 bg-white/55 p-7 shadow-sm backdrop-blur"
              >
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[#f4ddcf] text-sm font-bold text-[#57392d]">
                  {index + 1}
                </span>
                <p className="mt-5 text-lg font-medium leading-8 text-[#20342d]">{useCase}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="px-5 py-14 sm:px-8 lg:px-12">
        <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[0.72fr_1.28fr]">
          <div className="rounded-[2.5rem] bg-[#20342d] p-8 text-[#fffaf1] shadow-xl shadow-[#20342d]/10">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[#eebf9d]">FAQ</p>
            <h2 className="mt-4 font-serif text-4xl font-semibold leading-tight">
              Good boundaries make good coaching.
            </h2>
            <p className="mt-5 text-[#d8e5dd]">
              tranquil.coach is designed as practical daily support — not medical, legal, financial,
              or emergency care.
            </p>
          </div>
          <div className="grid gap-4">
            {page.faq.map((item) => (
              <details
                key={item.question}
                className="rounded-3xl border border-white/70 bg-white/60 p-5 shadow-sm backdrop-blur"
              >
                <summary className="cursor-pointer font-serif text-2xl font-semibold text-[#20342d]">
                  {item.question}
                </summary>
                <p className="mt-3 leading-7 text-[#637168]">{item.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="px-5 pb-20 pt-8 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-7xl rounded-[2.5rem] border border-white/70 bg-white/55 p-8 backdrop-blur sm:p-10">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[#5e8b76]">
            You might also need
          </p>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {siblingPages.map((item) => (
              <a
                key={item.topic}
                href={`/how-it-helps/${item.topic}`}
                className="rounded-[1.75rem] bg-[#fffaf1]/80 p-5 transition hover:-translate-y-0.5"
              >
                <h3 className="font-serif text-2xl font-semibold text-[#20342d]">{item.title}</h3>
                <p className="mt-3 text-sm leading-6 text-[#68756e]">{item.description}</p>
              </a>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
