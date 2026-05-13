import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getHelpTopic, helpTopics, siteUrl } from '../../../content/seo';

type Props = { params: Promise<{ topic: string }> };

export function generateStaticParams() {
  return helpTopics.map((topic) => ({ topic: topic.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { topic: slug } = await params;
  const topic = getHelpTopic(slug);
  if (!topic) return {};

  const url = `${siteUrl}/how-it-helps/${topic.slug}`;
  return {
    title: `${topic.title} | Lifecoach`,
    description: topic.description,
    alternates: { canonical: url },
    keywords: topic.keyphrases,
    openGraph: {
      title: topic.h1,
      description: topic.description,
      url,
      siteName: 'Lifecoach',
      images: [{ url: `${url}/opengraph-image`, width: 1200, height: 630, alt: topic.h1 }],
    },
    twitter: {
      card: 'summary_large_image',
      title: topic.h1,
      description: topic.description,
      images: [`${url}/opengraph-image`],
    },
  };
}

export default async function HelpTopicPage({ params }: Props) {
  const { topic: slug } = await params;
  const topic = getHelpTopic(slug);
  if (!topic) notFound();

  const url = `${siteUrl}/how-it-helps/${topic.slug}`;
  const faqSchema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: topic.faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: { '@type': 'Answer', text: faq.answer },
    })),
  };
  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
      { '@type': 'ListItem', position: 2, name: 'How it helps', item: `${siteUrl}/how-it-helps` },
      { '@type': 'ListItem', position: 3, name: topic.title, item: url },
    ],
  };

  return (
    <main className="min-h-screen bg-background">
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD is generated from typed repository content for search engines.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD is generated from typed repository content for search engines.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }}
      />
      <section className="px-5 py-6 sm:px-8 lg:px-12">
        <nav className="mx-auto flex max-w-7xl items-center justify-between rounded-full border border-border/70 bg-background/75 px-4 py-3 shadow-sm backdrop-blur">
          <a href="/" className="font-serif text-2xl font-semibold tracking-tight text-foreground">
            Lifecoach
          </a>
          <div className="hidden items-center gap-6 text-sm font-medium text-muted-foreground md:flex">
            <a href="/blog" className="transition hover:text-foreground">
              Blog
            </a>
            <a href="/#use-cases" className="transition hover:text-foreground">
              Use cases
            </a>
          </div>
          <a
            href={`/chat?prompt=${encodeURIComponent(topic.ctaPrompt)}`}
            className="rounded-full bg-foreground px-5 py-2.5 text-sm font-semibold text-background shadow-sm transition hover:-translate-y-0.5 hover:bg-accent"
          >
            Start here
          </a>
        </nav>
      </section>

      <section className="relative overflow-hidden px-5 pb-16 pt-10 sm:px-8 lg:px-12 lg:pb-24">
        <div className="absolute inset-x-0 top-0 -z-10 h-[520px] bg-[radial-gradient(circle_at_25%_10%,rgba(123,154,134,0.24),transparent_34%),radial-gradient(circle_at_80%_10%,rgba(198,123,99,0.16),transparent_34%)]" />
        <div className="mx-auto max-w-5xl">
          <p className="inline-flex rounded-full border border-accent/30 bg-accent/10 px-4 py-2 text-sm font-semibold text-foreground">
            {topic.audience}
          </p>
          <h1 className="mt-6 text-balance font-serif text-5xl font-semibold leading-[1.03] tracking-tight text-foreground sm:text-6xl">
            {topic.h1}
          </h1>
          <p className="mt-6 max-w-3xl text-pretty text-xl leading-9 text-muted-foreground">
            {topic.opener}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            {topic.keyphrases.map((phrase) => (
              <span
                key={phrase}
                className="rounded-full border border-border bg-background/80 px-4 py-2 text-sm font-medium text-muted-foreground shadow-sm"
              >
                {phrase}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="px-5 py-14 sm:px-8 lg:px-12">
        <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.85fr_1.15fr]">
          <div className="rounded-[2rem] border border-border bg-foreground p-8 text-background shadow-xl shadow-foreground/10">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-background/70">
              Concrete support
            </p>
            <h2 className="mt-4 font-serif text-4xl font-semibold leading-tight">
              Use it at the moment the day starts to jam.
            </h2>
            <p className="mt-5 leading-7 text-background/75">
              Same Lifecoach product and architecture: a coordinator that understands your context,
              optional Workspace help for admin, and specialist coaching styles for the situation in
              front of you.
            </p>
          </div>
          <div className="grid gap-4">
            {topic.useCases.map((useCase, index) => (
              <article
                key={useCase}
                className="flex gap-5 rounded-[1.75rem] border border-border bg-background/80 p-6 shadow-sm"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-foreground">
                  {index + 1}
                </span>
                <p className="text-lg font-medium leading-8 text-foreground">{useCase}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="px-5 py-14 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-5xl rounded-[2.5rem] border border-border bg-[#fbf7ef]/80 p-8 shadow-sm sm:p-10">
          <h2 className="font-serif text-4xl font-semibold text-foreground">
            Questions people ask
          </h2>
          <div className="mt-8 grid gap-5">
            {topic.faqs.map((faq) => (
              <details
                key={faq.question}
                className="rounded-3xl border border-border bg-background p-6"
              >
                <summary className="cursor-pointer text-lg font-semibold text-foreground">
                  {faq.question}
                </summary>
                <p className="mt-4 leading-7 text-muted-foreground">{faq.answer}</p>
              </details>
            ))}
          </div>
          <div className="mt-10 rounded-[2rem] bg-foreground p-7 text-background">
            <p className="font-serif text-3xl font-semibold">Start with this exact thing.</p>
            <p className="mt-3 text-background/75">{topic.ctaPrompt}</p>
            <a
              href={`/chat?prompt=${encodeURIComponent(topic.ctaPrompt)}`}
              className="mt-6 inline-flex rounded-full bg-background px-6 py-3 font-semibold text-foreground transition hover:-translate-y-0.5"
            >
              Open Lifecoach
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
