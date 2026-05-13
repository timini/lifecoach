import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { absoluteUrl, featureTopics, getFeatureTopic } from '../../../content/marketing';

export function generateStaticParams() {
  return featureTopics.map((topic) => ({ topic: topic.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ topic: string }>;
}): Promise<Metadata> {
  const { topic: slug } = await params;
  const topic = getFeatureTopic(slug);

  if (!topic) {
    return {};
  }

  const url = absoluteUrl(`/how-it-helps/${topic.slug}`);
  const image = absoluteUrl(`/og/how-it-helps/${topic.slug}`);

  return {
    title: topic.metaTitle,
    description: topic.metaDescription,
    alternates: { canonical: url },
    keywords: topic.keyphrases,
    openGraph: {
      title: topic.title,
      description: topic.metaDescription,
      url,
      type: 'website',
      images: [{ url: image, width: 1200, height: 630, alt: topic.title }],
    },
    twitter: {
      card: 'summary_large_image',
      title: topic.title,
      description: topic.metaDescription,
      images: [image],
    },
  };
}

export default async function FeatureTopicPage({
  params,
}: {
  params: Promise<{ topic: string }>;
}) {
  const { topic: slug } = await params;
  const topic = getFeatureTopic(slug);

  if (!topic) {
    notFound();
  }

  const faqSchema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: topic.faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: faq.answer,
      },
    })),
  };

  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Home',
        item: absoluteUrl('/'),
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'How it helps',
        item: absoluteUrl('/how-it-helps/overwhelm'),
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: topic.eyebrow,
        item: absoluteUrl(`/how-it-helps/${topic.slug}`),
      },
    ],
  };

  return (
    <main className="min-h-screen overflow-hidden">
      <script type="application/ld+json">{JSON.stringify(faqSchema)}</script>
      <script type="application/ld+json">{JSON.stringify(breadcrumbSchema)}</script>
      <section className="relative px-5 py-6 sm:px-8 lg:px-12">
        <div className="absolute inset-x-0 top-0 -z-10 h-[560px] bg-[radial-gradient(circle_at_18%_15%,rgba(123,154,134,0.24),transparent_34%),radial-gradient(circle_at_80%_8%,rgba(198,123,99,0.17),transparent_34%)]" />
        <nav className="mx-auto flex max-w-7xl items-center justify-between rounded-full border border-border/70 bg-background/75 px-4 py-3 shadow-sm backdrop-blur">
          <a href="/" className="font-serif text-2xl font-semibold tracking-tight text-foreground">
            Lifecoach
          </a>
          <div className="hidden items-center gap-6 text-sm font-medium text-muted-foreground md:flex">
            <a href="/blog" className="transition hover:text-foreground">
              Blog
            </a>
            <a href="/how-it-helps/adhd" className="transition hover:text-foreground">
              ADHD
            </a>
            <a href="/how-it-helps/personal-assistant" className="transition hover:text-foreground">
              Personal assistant
            </a>
          </div>
          <a
            href="/chat"
            className="rounded-full bg-foreground px-5 py-2.5 text-sm font-semibold text-background shadow-sm transition hover:-translate-y-0.5 hover:bg-accent"
          >
            Start this conversation
          </a>
        </nav>

        <div className="mx-auto grid max-w-7xl gap-10 pb-14 pt-16 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:pb-20 lg:pt-24">
          <div>
            <p className="mb-5 inline-flex rounded-full border border-accent/30 bg-accent/10 px-4 py-2 text-sm font-semibold text-foreground">
              {topic.eyebrow} · {topic.audience}
            </p>
            <h1 className="max-w-4xl text-balance font-serif text-5xl font-semibold leading-[1.02] tracking-tight text-foreground sm:text-6xl">
              {topic.title}
            </h1>
            <p className="mt-6 max-w-2xl text-pretty text-lg leading-8 text-muted-foreground sm:text-xl">
              {topic.opener}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a
                href={`/chat?prompt=${encodeURIComponent(topic.ctaPrompt)}`}
                className="inline-flex items-center justify-center rounded-full bg-foreground px-7 py-4 text-base font-semibold text-background shadow-lg shadow-foreground/10 transition hover:-translate-y-0.5 hover:bg-accent"
              >
                Start with this prompt
              </a>
              <a
                href="/blog"
                className="inline-flex items-center justify-center rounded-full border border-border bg-background/70 px-7 py-4 text-base font-semibold text-foreground transition hover:-translate-y-0.5 hover:border-accent"
              >
                Read the blog
              </a>
            </div>
          </div>

          <aside className="rounded-[2rem] border border-border bg-[#fbf7ef]/90 p-6 shadow-2xl shadow-foreground/10 backdrop-blur">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-accent">
              Target searches
            </p>
            <ul className="mt-5 flex flex-wrap gap-3">
              {topic.keyphrases.map((phrase) => (
                <li
                  key={phrase}
                  className="rounded-full border border-border bg-background/80 px-4 py-2 text-sm font-semibold text-foreground"
                >
                  {phrase}
                </li>
              ))}
            </ul>
            <div className="mt-7 rounded-[1.5rem] border border-border bg-background p-5">
              <p className="text-sm font-semibold text-muted-foreground">Scoped starter</p>
              <p className="mt-3 font-serif text-2xl font-semibold leading-tight">
                “{topic.ctaPrompt}”
              </p>
            </div>
          </aside>
        </div>
      </section>

      <section className="px-5 py-14 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-7xl">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-accent">
              Concrete ways it helps
            </p>
            <h2 className="mt-3 font-serif text-4xl font-semibold leading-tight">
              Built for the moment you are actually stuck in.
            </h2>
          </div>
          <div className="mt-9 grid gap-4 md:grid-cols-2">
            {topic.useCases.map((useCase, index) => (
              <article
                key={useCase}
                className="rounded-[1.75rem] border border-border bg-background/80 p-6 shadow-sm"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-foreground">
                  {index + 1}
                </span>
                <p className="mt-5 text-lg font-medium leading-8 text-foreground">{useCase}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="px-5 py-14 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-5xl rounded-[2.5rem] border border-border bg-foreground p-8 text-background shadow-xl shadow-foreground/10 sm:p-10">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-background/70">
            FAQ
          </p>
          <div className="mt-7 grid gap-5">
            {topic.faqs.map((faq) => (
              <article key={faq.question} className="rounded-[1.5rem] bg-background/10 p-6">
                <h2 className="font-serif text-2xl font-semibold leading-tight">{faq.question}</h2>
                <p className="mt-3 leading-7 text-background/75">{faq.answer}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
