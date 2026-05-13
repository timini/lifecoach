import type { ReactNode } from 'react';
import { featurePages } from '../lib/marketing/feature-pages';

const capabilities = [
  {
    title: 'Turns your life context into momentum',
    body: 'Lifecoach blends the time of day, weather, nearby context, goals, and recent progress into every conversation so advice starts from where you actually are.',
  },
  {
    title: 'Remembers the person, not just the prompt',
    body: 'Important details such as priorities, routines, dislikes, and recurring blockers are carried forward, creating a relationship that compounds over time.',
  },
  {
    title: 'Works where your day already lives',
    body: 'Connect Google Workspace when you want help reading email, planning calendar moves, triaging tasks, or turning loose intent into a next action.',
  },
];

const workflows = [
  'Morning plan built around energy, meetings, weather, and one real priority.',
  'Inbox triage that separates noise from decisions and drafts the next step.',
  'Evening reflection that captures wins, gratitude, and what to adjust tomorrow.',
];

const proofPoints = [
  { value: '0', label: 'setup steps before your first chat' },
  { value: '24/7', label: 'coach that keeps the thread warm' },
  { value: '1', label: 'place for goals, tasks, reflection, and context' },
];

const principles = [
  'Short, warm, human replies — no corporate life-hack essays.',
  'Browser-only location sharing; no IP geolocation fallbacks.',
  'Workspace OAuth tokens stay in the app layer and never go to the model.',
  'Billing and auth state are handled by deterministic policy, not by vibes.',
];

export default function LandingPage() {
  return (
    <main className="min-h-screen overflow-hidden">
      <section className="relative px-5 py-6 sm:px-8 lg:px-12">
        <div className="absolute inset-x-0 top-0 -z-10 h-[620px] bg-[radial-gradient(circle_at_20%_15%,rgba(123,154,134,0.22),transparent_34%),radial-gradient(circle_at_80%_10%,rgba(198,123,99,0.16),transparent_34%)]" />
        <nav className="mx-auto flex max-w-7xl items-center justify-between rounded-full border border-border/70 bg-background/75 px-4 py-3 shadow-sm backdrop-blur">
          <a href="/" className="font-serif text-2xl font-semibold tracking-tight text-foreground">
            Lifecoach
          </a>
          <div className="hidden items-center gap-6 text-sm font-medium text-muted-foreground md:flex">
            <a href="#how-it-works" className="transition hover:text-foreground">
              How it works
            </a>
            <a href="#privacy" className="transition hover:text-foreground">
              Privacy
            </a>
            <a href="#use-cases" className="transition hover:text-foreground">
              Use cases
            </a>
            <a href="/blog" className="transition hover:text-foreground">
              Blog
            </a>
          </div>
          <a
            href="/chat"
            className="rounded-full bg-foreground px-5 py-2.5 text-sm font-semibold text-background shadow-sm transition hover:-translate-y-0.5 hover:bg-accent"
          >
            Start coaching
          </a>
        </nav>

        <div className="mx-auto grid max-w-7xl gap-12 pb-16 pt-16 lg:grid-cols-[1.04fr_0.96fr] lg:items-center lg:pb-24 lg:pt-24">
          <div>
            <p className="mb-5 inline-flex rounded-full border border-accent/30 bg-accent/10 px-4 py-2 text-sm font-semibold text-foreground">
              The AI assistant that prevents overwhelm
            </p>
            <h1 className="max-w-4xl text-balance font-serif text-5xl font-semibold leading-[1.02] tracking-tight text-foreground sm:text-6xl lg:text-7xl">
              A calmer way through the admin pile.
            </h1>
            <p className="mt-6 max-w-2xl text-pretty text-lg leading-8 text-muted-foreground sm:text-xl">
              Lifecoach is a warm, conversational companion for people whose executive function and
              daily admin are the bottleneck — ADHD, depression, burnout, anxiety, peri/menopause,
              new-parent fog, and the ordinary overwhelm of modern life. It remembers what matters,
              understands your context, and turns the pile into one humane next step.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a
                href="/chat"
                className="inline-flex items-center justify-center rounded-full bg-foreground px-7 py-4 text-base font-semibold text-background shadow-lg shadow-foreground/10 transition hover:-translate-y-0.5 hover:bg-accent"
              >
                Try the coach free
              </a>
              <a
                href="#how-it-works"
                className="inline-flex items-center justify-center rounded-full border border-border bg-background/70 px-7 py-4 text-base font-semibold text-foreground transition hover:-translate-y-0.5 hover:border-accent"
              >
                See the product
              </a>
            </div>
            <dl className="mt-10 grid max-w-2xl grid-cols-3 gap-3">
              {proofPoints.map((point) => (
                <div
                  key={point.label}
                  className="rounded-3xl border border-border/70 bg-background/70 p-4 shadow-sm backdrop-blur"
                >
                  <dt className="font-serif text-3xl font-semibold text-foreground">
                    {point.value}
                  </dt>
                  <dd className="mt-1 text-xs leading-5 text-muted-foreground">{point.label}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="relative">
            <div className="absolute -left-10 top-16 -z-10 h-44 w-44 rounded-full bg-accent/20 blur-3xl" />
            <div className="rounded-[2rem] border border-border bg-[#fbf7ef]/90 p-4 shadow-2xl shadow-foreground/10 backdrop-blur">
              <div className="rounded-[1.5rem] border border-border/80 bg-background p-5">
                <div className="flex items-center justify-between border-b border-border/70 pb-4">
                  <div>
                    <p className="font-serif text-2xl font-semibold">Today with Lifecoach</p>
                    <p className="text-sm text-muted-foreground">Context-aware plan · 8:14 AM</p>
                  </div>
                  <span className="rounded-full bg-success/15 px-3 py-1 text-xs font-semibold text-foreground">
                    calm mode
                  </span>
                </div>
                <div className="space-y-4 py-5">
                  <ChatBubble align="left">
                    Good morning. You have three meetings, rain after lunch, and that launch review
                    you wanted to protect. Want a plan that keeps the hard thinking before noon?
                  </ChatBubble>
                  <ChatBubble align="right">
                    Yes. I also need to answer Mara and get a workout in.
                  </ChatBubble>
                  <ChatBubble align="left">
                    Great. First: 45 minutes on the launch review before messages. Then I can pull
                    Mara&apos;s thread, draft a reply, and save the workout for the dry window at 5.
                  </ChatBubble>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  {['Plan day', 'Triage inbox', 'Log goal'].map((action) => (
                    <button
                      key={action}
                      type="button"
                      className="rounded-2xl border border-border bg-muted/60 px-3 py-3 text-sm font-semibold text-foreground"
                    >
                      {action}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="how-it-works" className="px-5 py-16 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-7xl">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-accent">
              Product thesis
            </p>
            <h2 className="mt-3 font-serif text-4xl font-semibold leading-tight sm:text-5xl">
              Coaching gets better when it can see the calendar, the context, and the pattern.
            </h2>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {capabilities.map((capability) => (
              <article
                key={capability.title}
                className="rounded-[2rem] border border-border bg-background/75 p-7 shadow-sm"
              >
                <h3 className="font-serif text-2xl font-semibold leading-tight">
                  {capability.title}
                </h3>
                <p className="mt-4 text-sm leading-7 text-muted-foreground">{capability.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="use-cases" className="px-5 py-16 sm:px-8 lg:px-12">
        <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
          <div className="rounded-[2rem] border border-border bg-foreground p-8 text-background shadow-xl shadow-foreground/10">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-background/70">
              Where it helps
            </p>
            <h2 className="mt-4 font-serif text-4xl font-semibold leading-tight">
              The daily operating system for people with more intent than bandwidth.
            </h2>
            <p className="mt-5 text-background/75">
              Lifecoach is built for the fuzzy middle between productivity apps and therapy: the
              place where you need a thoughtful nudge, a practical plan, and a record of what you
              said mattered.
            </p>
          </div>
          <div className="grid gap-4">
            {workflows.map((workflow, index) => (
              <div
                key={workflow}
                className="flex gap-5 rounded-[1.75rem] border border-border bg-background/80 p-6 shadow-sm"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-foreground">
                  {index + 1}
                </span>
                <p className="text-lg font-medium leading-8 text-foreground">{workflow}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-5 py-16 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-7xl">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-accent">
              How it helps
            </p>
            <h2 className="mt-3 font-serif text-4xl font-semibold leading-tight sm:text-5xl">
              One product, specific pages for the moments people actually search for.
            </h2>
            <p className="mt-5 text-lg leading-8 text-muted-foreground">
              The architecture stays broad; the entry points get precise. Start with overwhelm,
              ADHD, depression, anxiety, wellness, career, menopause, or personal-assistant admin.
            </p>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {featurePages.map((page) => (
              <a
                key={page.topic}
                href={`/how-it-helps/${page.topic}`}
                className="rounded-[1.5rem] border border-border bg-background/80 p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-accent"
              >
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
                  {page.audience}
                </p>
                <h3 className="mt-3 font-serif text-2xl font-semibold leading-tight text-foreground">
                  {page.title}
                </h3>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">{page.description}</p>
              </a>
            ))}
          </div>
        </div>
      </section>

      <section id="privacy" className="px-5 py-16 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-7xl rounded-[2.5rem] border border-border bg-[#fbf7ef]/80 p-8 shadow-sm sm:p-10 lg:p-12">
          <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.24em] text-accent">
                Trust by design
              </p>
              <h2 className="mt-3 font-serif text-4xl font-semibold leading-tight">
                Personal enough to be useful. Guardrailed enough to feel safe.
              </h2>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2">
              {principles.map((principle) => (
                <li
                  key={principle}
                  className="rounded-3xl border border-border bg-background/80 p-5 text-sm font-medium leading-7 text-muted-foreground"
                >
                  <span className="mr-2 text-accent">✦</span>
                  {principle}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="px-5 pb-20 pt-10 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="font-serif text-4xl font-semibold leading-tight sm:text-6xl">
            Start with one honest sentence.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">
            Tell Lifecoach what is on your mind today. It will help you find the next grounded,
            doable move without asking you to become a different person first.
          </p>
          <a
            href="/chat"
            className="mt-8 inline-flex items-center justify-center rounded-full bg-foreground px-8 py-4 text-base font-semibold text-background shadow-lg shadow-foreground/10 transition hover:-translate-y-0.5 hover:bg-accent"
          >
            Open Lifecoach
          </a>
        </div>
      </section>
    </main>
  );
}

function ChatBubble({ children, align }: { children: ReactNode; align: 'left' | 'right' }) {
  return (
    <div className={align === 'right' ? 'flex justify-end' : 'flex justify-start'}>
      <p
        className={
          align === 'right'
            ? 'max-w-[82%] rounded-[1.35rem] bg-accent px-4 py-3 text-sm leading-6 text-accent-foreground'
            : 'max-w-[88%] rounded-[1.35rem] bg-muted px-4 py-3 text-sm leading-6 text-foreground'
        }
      >
        {children}
      </p>
    </div>
  );
}
