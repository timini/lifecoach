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
    <main className="min-h-screen overflow-hidden">
      <script type="application/ld+json">{JSON.stringify(faqJsonLd)}</script>
      <script type="application/ld+json">{JSON.stringify(breadcrumbJsonLd)}</script>
      <section className="relative px-5 py-6 sm:px-8 lg:px-12">
        <div className="absolute inset-x-0 top-0 -z-10 h-[560px] bg-[radial-gradient(circle_at_25%_20%,rgba(123,154,134,0.26),transparent_34%),radial-gradient(circle_at_82%_8%,rgba(198,123,99,0.18),transparent_34%)]" />
        <nav className="mx-auto flex max-w-7xl items-center justify-between rounded-full border border-white/65 bg-background/70 px-4 py-3 shadow-sm backdrop-blur">
          <a href="/" className="font-serif text-2xl font-semibold tracking-tight text-foreground">
            tranquil.coach
          </a>
          <div className="hidden items-center gap-6 text-sm font-medium text-muted-foreground md:flex">
            <a href="/blog" className="transition hover:text-foreground">
              Blog
            </a>
            <a href="/#privacy" className="transition hover:text-foreground">
              Privacy
            </a>
          </div>
          <a
            href={`/chat?prompt=${encodeURIComponent(page.ctaPrompt)}`}
            className="rounded-full bg-foreground px-5 py-2.5 text-sm font-semibold text-background shadow-sm transition hover:-translate-y-0.5 hover:bg-accent"
          >
            Begin softly
          </a>
        </nav>

        <div className="mx-auto grid max-w-7xl gap-10 pb-14 pt-16 lg:grid-cols-[1.08fr_0.92fr] lg:items-center lg:pb-20 lg:pt-24">
          <div>
            <p className="mb-5 inline-flex rounded-full border border-accent/30 bg-accent/10 px-4 py-2 text-sm font-semibold text-foreground">
              {page.eyebrow}
            </p>
            <h1 className="max-w-4xl text-balance font-serif text-5xl font-semibold leading-[1.02] tracking-tight text-foreground sm:text-6xl lg:text-7xl">
              {page.h1}
            </h1>
            <p className="mt-6 max-w-2xl text-pretty text-lg leading-8 text-muted-foreground sm:text-xl">
              {page.opener}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a
                href={`/chat?prompt=${encodeURIComponent(page.ctaPrompt)}`}
                className="inline-flex items-center justify-center rounded-full bg-foreground px-7 py-4 text-base font-semibold text-background shadow-lg shadow-foreground/10 transition hover:-translate-y-0.5 hover:bg-accent"
              >
                Start this thread
              </a>
              <a
                href="/blog"
                className="inline-flex items-center justify-center rounded-full border border-border bg-background/70 px-7 py-4 text-base font-semibold text-foreground transition hover:-translate-y-0.5 hover:border-accent"
              >
                Read the blog
              </a>
            </div>
          </div>

          <aside className="rounded-[2rem] border border-border bg-white/45 backdrop-blur-xl p-6 shadow-2xl shadow-foreground/10">
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-accent">
              Search doorway
            </p>
            <ul className="mt-5 grid gap-3">
              {page.keyphrases.map((phrase) => (
                <li
                  key={phrase}
                  className="rounded-2xl border border-white/65 bg-background/70 px-4 py-3 text-sm font-semibold text-foreground"
                >
                  {phrase}
                </li>
              ))}
            </ul>
            <p className="mt-6 rounded-3xl bg-foreground p-5 text-sm leading-7 text-background/80">
              Built for: <span className="font-semibold text-background">{page.audience}</span>
            </p>
          </aside>
        </div>
      </section>

      <section className="px-5 py-14 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-7xl">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-accent">
              Concrete rituals
            </p>
            <h2 className="mt-3 font-serif text-4xl font-semibold leading-tight sm:text-5xl">
              Rituals that start where the stuckness actually is.
            </h2>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-2">
            {page.useCases.map((useCase) => (
              <article
                key={useCase}
                className="rounded-[2rem] border border-border bg-background/75 p-7 shadow-sm"
              >
                <p className="text-lg font-medium leading-8 text-foreground">{useCase}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="px-5 py-14 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-5xl rounded-[2.5rem] border border-border bg-white/45 backdrop-blur-xl p-8 shadow-sm sm:p-10">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-accent">FAQ</p>
          <div className="mt-6 grid gap-4">
            {page.faq.map((item) => (
              <details
                key={item.question}
                className="rounded-3xl border border-border bg-background/85 p-5"
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
