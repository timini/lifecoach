import { absoluteUrl, getHelpTopic, helpTopics } from '@/lib/marketing';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

type PageProps = { params: Promise<{ topic: string }> };

export function generateStaticParams() {
  return helpTopics.map((topic) => ({ topic: topic.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { topic: slug } = await params;
  const topic = getHelpTopic(slug);

  if (!topic) {
    return {};
  }

  const url = absoluteUrl(`/how-it-helps/${topic.slug}`);
  const images = [{ url: absoluteUrl(`/og/${topic.slug}`), width: 1200, height: 630 }];

  return {
    title: topic.title,
    description: topic.description,
    alternates: { canonical: url },
    keywords: topic.keyphrases,
    openGraph: {
      title: topic.h1,
      description: topic.description,
      url,
      type: 'website',
      images,
    },
    twitter: {
      card: 'summary_large_image',
      title: topic.h1,
      description: topic.description,
      images: images.map((image) => image.url),
    },
  };
}

export default async function HelpTopicPage({ params }: PageProps) {
  const { topic: slug } = await params;
  const topic = getHelpTopic(slug);

  if (!topic) {
    notFound();
  }

  const pageUrl = absoluteUrl(`/how-it-helps/${topic.slug}`);
  const faqJsonLd = {
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
  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: absoluteUrl('/') },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'How it helps',
        item: absoluteUrl('/how-it-helps/overwhelm'),
      },
      { '@type': 'ListItem', position: 3, name: topic.audience, item: pageUrl },
    ],
  };

  return (
    <main className="min-h-screen overflow-hidden">
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD is generated from typed local content.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD is generated from typed local content.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      <section className="relative px-5 py-6 sm:px-8 lg:px-12">
        <div className="absolute inset-x-0 top-0 -z-10 h-[560px] bg-[radial-gradient(circle_at_16%_12%,rgba(123,154,134,0.24),transparent_34%),radial-gradient(circle_at_84%_8%,rgba(198,123,99,0.18),transparent_34%)]" />
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
            href={`/chat?message=${encodeURIComponent(topic.ctaPrompt)}`}
            className="rounded-full bg-foreground px-5 py-2.5 text-sm font-semibold text-background shadow-sm transition hover:-translate-y-0.5 hover:bg-accent"
          >
            Start this conversation
          </a>
        </nav>

        <div className="mx-auto grid max-w-7xl gap-10 pb-16 pt-16 lg:grid-cols-[1.03fr_0.97fr] lg:items-center lg:pb-24 lg:pt-24">
          <div>
            <p className="mb-5 inline-flex rounded-full border border-accent/30 bg-accent/10 px-4 py-2 text-sm font-semibold text-foreground">
              {topic.audience}
            </p>
            <h1 className="max-w-4xl text-balance font-serif text-5xl font-semibold leading-[1.02] tracking-tight text-foreground sm:text-6xl lg:text-7xl">
              {topic.h1}
            </h1>
            <p className="mt-6 max-w-2xl text-pretty text-lg leading-8 text-muted-foreground sm:text-xl">
              {topic.opener}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a
                href={`/chat?message=${encodeURIComponent(topic.ctaPrompt)}`}
                className="inline-flex items-center justify-center rounded-full bg-foreground px-7 py-4 text-base font-semibold text-background shadow-lg shadow-foreground/10 transition hover:-translate-y-0.5 hover:bg-accent"
              >
                {topic.ctaPrompt}
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
            <ul className="mt-5 grid gap-3">
              {topic.keyphrases.map((phrase) => (
                <li
                  key={phrase}
                  className="rounded-2xl border border-border bg-background/80 px-4 py-3 text-sm font-semibold text-foreground"
                >
                  {phrase}
                </li>
              ))}
            </ul>
            <p className="mt-5 text-sm leading-7 text-muted-foreground">Intent: {topic.intent}</p>
          </aside>
        </div>
      </section>

      <section className="px-5 py-16 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-7xl">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-accent">
              Concrete moments
            </p>
            <h2 className="mt-3 font-serif text-4xl font-semibold leading-tight sm:text-5xl">
              Built for the moments where advice usually gets too abstract.
            </h2>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-2">
            {topic.useCases.map((useCase) => (
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

      <section className="px-5 py-16 sm:px-8 lg:px-12">
        <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.75fr_1.25fr]">
          <div className="rounded-[2rem] border border-border bg-foreground p-8 text-background shadow-xl shadow-foreground/10">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-background/70">
              FAQ schema included
            </p>
            <h2 className="mt-4 font-serif text-4xl font-semibold leading-tight">
              Questions people actually search before they try a coach.
            </h2>
          </div>
          <div className="grid gap-4">
            {topic.faqs.map((faq) => (
              <details
                key={faq.question}
                className="rounded-[1.75rem] border border-border bg-background/80 p-6 shadow-sm"
              >
                <summary className="cursor-pointer font-serif text-2xl font-semibold leading-tight text-foreground">
                  {faq.question}
                </summary>
                <p className="mt-4 text-sm leading-7 text-muted-foreground">{faq.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
