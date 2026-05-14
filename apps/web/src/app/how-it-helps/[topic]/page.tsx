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
    <main className="min-h-screen overflow-hidden bg-[#f7f0e6]">
      <script type="application/ld+json">{JSON.stringify(faqJsonLd)}</script>
      <script type="application/ld+json">{JSON.stringify(breadcrumbJsonLd)}</script>
      <section className="relative px-5 py-6 sm:px-8 lg:px-12">
        <div className="absolute inset-x-0 top-0 -z-10 h-[42rem] bg-[radial-gradient(circle_at_20%_16%,rgba(128,100,210,0.18),transparent_30%),radial-gradient(circle_at_82%_10%,rgba(72,151,130,0.22),transparent_32%),radial-gradient(circle_at_52%_72%,rgba(230,156,102,0.16),transparent_34%)]" />
        <nav className="mx-auto flex max-w-7xl items-center justify-between rounded-full border border-white/70 bg-white/55 px-4 py-3 shadow-[0_20px_80px_rgba(47,59,52,0.08)] backdrop-blur-xl">
          <a href="/" className="flex items-center gap-3 text-foreground">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-foreground text-lg text-background">
              ◒
            </span>
            <span className="font-serif text-2xl font-semibold tracking-tight">tranquil.coach</span>
          </a>
          <div className="hidden items-center gap-6 text-sm font-semibold text-muted-foreground md:flex">
            <a href="/how-it-helps" className="transition hover:text-foreground">
              All paths
            </a>
            <a href="/blog" className="transition hover:text-foreground">
              Field notes
            </a>
            <a href="/#privacy" className="transition hover:text-foreground">
              Trust
            </a>
          </div>
          <a
            href={`/chat?prompt=${encodeURIComponent(page.ctaPrompt)}`}
            className="rounded-full bg-foreground px-5 py-2.5 text-sm font-semibold text-background shadow-sm transition hover:-translate-y-0.5 hover:bg-accent"
          >
            Start here
          </a>
        </nav>

        <div className="mx-auto grid max-w-7xl gap-10 pb-14 pt-16 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:pb-20 lg:pt-24">
          <div>
            <p className="mb-5 inline-flex rounded-full border border-white/70 bg-white/55 px-4 py-2 text-sm font-bold text-foreground shadow-sm backdrop-blur">
              {page.eyebrow}
            </p>
            <h1 className="max-w-4xl text-balance font-serif text-6xl font-semibold leading-[0.98] tracking-[-0.045em] text-foreground sm:text-7xl lg:text-8xl">
              {page.h1}
            </h1>
            <p className="mt-7 max-w-2xl text-pretty text-lg leading-8 text-muted-foreground sm:text-xl">
              {page.opener}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a
                href={`/chat?prompt=${encodeURIComponent(page.ctaPrompt)}`}
                className="inline-flex items-center justify-center rounded-full bg-foreground px-7 py-4 text-base font-semibold text-background shadow-lg shadow-foreground/10 transition hover:-translate-y-0.5 hover:bg-accent"
              >
                Start this conversation
              </a>
              <a
                href="/how-it-helps"
                className="inline-flex items-center justify-center rounded-full border border-white/70 bg-white/50 px-7 py-4 text-base font-semibold text-foreground shadow-sm backdrop-blur transition hover:-translate-y-0.5 hover:border-accent"
              >
                Browse other paths
              </a>
            </div>
          </div>

          <aside className="relative overflow-hidden rounded-[2.5rem] border border-white/70 bg-white/50 p-6 shadow-2xl shadow-foreground/10 backdrop-blur">
            <span className="absolute -right-6 -top-8 font-serif text-9xl text-accent/10">◒</span>
            <p className="relative text-sm font-bold uppercase tracking-[0.22em] text-accent">
              Search doorway
            </p>
            <ul className="relative mt-5 grid gap-3">
              {page.keyphrases.map((phrase) => (
                <li
                  key={phrase}
                  className="rounded-2xl border border-border/70 bg-[#fcf8f1]/90 px-4 py-3 text-sm font-bold text-foreground"
                >
                  {phrase}
                </li>
              ))}
            </ul>
            <p className="relative mt-6 rounded-3xl bg-foreground p-5 text-sm leading-7 text-background/80">
              Built for: <span className="font-semibold text-background">{page.audience}</span>
            </p>
          </aside>
        </div>
      </section>

      <section className="px-5 py-14 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-7xl">
          <div className="max-w-3xl">
            <p className="text-sm font-bold uppercase tracking-[0.24em] text-accent">
              Concrete ways to use it
            </p>
            <h2 className="mt-3 font-serif text-4xl font-semibold leading-tight sm:text-6xl">
              Use cases that start where the stuckness actually is.
            </h2>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-2">
            {page.useCases.map((useCase, index) => (
              <article
                key={useCase}
                className="rounded-[2.25rem] border border-white/70 bg-white/50 p-7 shadow-sm backdrop-blur"
              >
                <p className="text-sm font-bold uppercase tracking-[0.2em] text-accent">
                  scenario {index + 1}
                </p>
                <p className="mt-4 text-lg font-semibold leading-8 text-foreground">{useCase}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="px-5 py-14 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-5xl rounded-[2.75rem] border border-white/70 bg-[#fcf8f1]/80 p-8 shadow-sm backdrop-blur sm:p-10">
          <p className="text-sm font-bold uppercase tracking-[0.24em] text-accent">FAQ</p>
          <div className="mt-6 grid gap-4">
            {page.faq.map((item) => (
              <details
                key={item.question}
                className="rounded-3xl border border-border/70 bg-white/70 p-5"
              >
                <summary className="cursor-pointer font-serif text-2xl font-semibold text-foreground">
                  {item.question}
                </summary>
                <p className="mt-3 leading-7 text-muted-foreground">{item.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
