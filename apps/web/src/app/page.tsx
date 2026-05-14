import type { ReactNode } from 'react';
import { featurePages } from '../lib/marketing/feature-pages';

const rituals = [
  {
    time: '08:12',
    title: 'Dawn sort',
    body: 'Three meetings, rain at lunch, one launch review worth protecting.',
  },
  {
    time: '11:40',
    title: 'Inbox exhale',
    body: 'Mara needs a decision. Everything else can wait until the afternoon pass.',
  },
  {
    time: '17:05',
    title: 'Gentle close',
    body: 'One win logged, tomorrow softened, no shame carried forward.',
  },
];

const capabilities = [
  {
    eyebrow: 'Sense',
    title: 'Reads the weather of your day',
    body: 'tranquil.coach blends calendar pressure, local context, goals, routines, and recent progress so coaching starts from reality rather than an empty prompt box.',
  },
  {
    eyebrow: 'Soften',
    title: 'Turns overwhelm into a humane sequence',
    body: 'Instead of dumping a productivity system on you, it helps choose the next grounded action: the message, the meal, the errand, the pause, the ten-minute reset.',
  },
  {
    eyebrow: 'Remember',
    title: 'Keeps the thread warm over time',
    body: 'Priorities, dislikes, patterns, blockers, and wins compound into a coach that feels less like software and more like a calm second nervous system.',
  },
];

const productMoments = [
  'A morning plan that respects meetings, energy, weather, and one real priority.',
  'A body-double style start for the task you keep orbiting but cannot begin.',
  'Inbox and calendar triage that separates urgent, emotional, and actually important.',
  'An evening reflection that notices wins and makes tomorrow less sharp.',
];

const proofPoints = [
  { value: '0', label: 'setup steps before the first conversation' },
  { value: '1', label: 'quiet place for goals, tasks, reflection, and context' },
  { value: '24/7', label: 'steady companion when the pile starts humming' },
];

const principles = [
  'Warm, short, human replies — never corporate life-hack sludge.',
  'Browser-only location sharing; no IP geolocation fallbacks.',
  'Workspace OAuth tokens stay in the app layer and never go to the model.',
  'Every suggestion aims to lower shame and activation energy.',
];

export default function LandingPage() {
  return (
    <main className="min-h-screen overflow-hidden bg-[linear-gradient(180deg,rgba(250,247,239,0.92)_0%,rgba(235,243,235,0.78)_42%,rgba(244,239,230,1)_100%)]">
      <section className="relative px-5 py-6 sm:px-8 lg:px-12">
        <div className="absolute left-1/2 top-[-180px] -z-10 h-[560px] w-[560px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(126,162,143,0.38),transparent_68%)] blur-2xl" />
        <div className="absolute right-[-120px] top-48 -z-10 h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle,rgba(208,149,132,0.24),transparent_66%)] blur-3xl" />
        <nav className="mx-auto flex max-w-7xl items-center justify-between rounded-full border border-white/60 bg-background/70 px-4 py-3 shadow-[0_18px_60px_rgba(47,59,52,0.08)] backdrop-blur-xl">
          <a
            href="/"
            className="flex items-center gap-3 text-foreground"
            aria-label="tranquil.coach home"
          >
            <span className="grid h-9 w-9 place-items-center rounded-full bg-foreground text-lg text-background shadow-inner">
              ◐
            </span>
            <span className="font-serif text-2xl font-semibold tracking-tight">tranquil.coach</span>
          </a>
          <div className="hidden items-center gap-6 text-sm font-medium text-muted-foreground md:flex">
            <a href="#ritual" className="transition hover:text-foreground">
              Product
            </a>
            <a href="#use-cases" className="transition hover:text-foreground">
              Use cases
            </a>
            <a href="#privacy" className="transition hover:text-foreground">
              Trust
            </a>
            <a href="/blog" className="transition hover:text-foreground">
              Journal
            </a>
          </div>
          <a
            href="/chat"
            className="rounded-full bg-foreground px-5 py-2.5 text-sm font-semibold text-background shadow-sm transition hover:-translate-y-0.5 hover:bg-accent"
          >
            Begin softly
          </a>
        </nav>

        <div className="mx-auto grid max-w-7xl gap-12 pb-16 pt-16 lg:grid-cols-[1.02fr_0.98fr] lg:items-center lg:pb-24 lg:pt-24">
          <div>
            <p className="mb-5 inline-flex rounded-full border border-white/70 bg-white/55 px-4 py-2 text-sm font-semibold text-foreground shadow-sm backdrop-blur">
              AI coaching for the overfull, overthinking, almost-starting moment
            </p>
            <h1 className="max-w-5xl text-balance font-serif text-6xl font-semibold leading-[0.94] tracking-tight text-foreground sm:text-7xl lg:text-8xl">
              A beautiful way to meet the day before it becomes a pile.
            </h1>
            <p className="mt-7 max-w-2xl text-pretty text-lg leading-8 text-muted-foreground sm:text-xl">
              tranquil.coach is a calm conversational companion for ADHD, burnout, anxiety,
              depression, peri/menopause fog, new-parent haze, career knots, and everyday admin. It
              remembers what matters, understands the shape of your day, and turns the loud cloud
              into one kind next move.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <a
                href="/chat"
                className="inline-flex items-center justify-center rounded-full bg-foreground px-8 py-4 text-base font-semibold text-background shadow-xl shadow-foreground/10 transition hover:-translate-y-0.5 hover:bg-accent"
              >
                Try tranquil.coach
              </a>
              <a
                href="#ritual"
                className="inline-flex items-center justify-center rounded-full border border-white/70 bg-white/50 px-8 py-4 text-base font-semibold text-foreground shadow-sm backdrop-blur transition hover:-translate-y-0.5 hover:border-accent"
              >
                See the ritual
              </a>
            </div>
            <dl className="mt-10 grid max-w-2xl gap-3 sm:grid-cols-3">
              {proofPoints.map((point) => (
                <div
                  key={point.label}
                  className="rounded-[1.75rem] border border-white/65 bg-white/45 p-5 shadow-sm backdrop-blur"
                >
                  <dt className="font-serif text-4xl font-semibold text-foreground">
                    {point.value}
                  </dt>
                  <dd className="mt-2 text-xs leading-5 text-muted-foreground">{point.label}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="relative" id="ritual">
            <div className="absolute -left-8 top-10 -z-10 h-52 w-52 rounded-full bg-accent/25 blur-3xl" />
            <div className="rotate-1 rounded-[2.5rem] border border-white/70 bg-white/45 p-3 shadow-2xl shadow-foreground/10 backdrop-blur-xl">
              <div className="-rotate-1 rounded-[2rem] border border-border/70 bg-[#fffaf1]/92 p-5">
                <div className="flex items-start justify-between gap-4 border-b border-border/70 pb-5">
                  <div>
                    <p className="text-sm font-semibold uppercase tracking-[0.24em] text-accent">
                      Today’s tranquil thread
                    </p>
                    <h2 className="mt-2 font-serif text-3xl font-semibold leading-tight">
                      Less command center. More quiet conservatory.
                    </h2>
                  </div>
                  <span className="rounded-full bg-success/15 px-3 py-1 text-xs font-semibold text-foreground">
                    calm mode
                  </span>
                </div>
                <div className="grid gap-4 py-5">
                  {rituals.map((ritual) => (
                    <article
                      key={ritual.title}
                      className="grid grid-cols-[4rem_1fr] gap-4 rounded-[1.5rem] border border-border/70 bg-background/70 p-4 shadow-sm"
                    >
                      <p className="font-serif text-2xl font-semibold text-accent">{ritual.time}</p>
                      <div>
                        <h3 className="font-semibold text-foreground">{ritual.title}</h3>
                        <p className="mt-1 text-sm leading-6 text-muted-foreground">
                          {ritual.body}
                        </p>
                      </div>
                    </article>
                  ))}
                </div>
                <div className="space-y-3 rounded-[1.5rem] bg-foreground p-4 text-background">
                  <ChatBubble align="left">
                    What is the smallest version of today that still cares for you?
                  </ChatBubble>
                  <ChatBubble align="right">
                    Protect the launch review, answer Mara, and make dinner easier.
                  </ChatBubble>
                  <ChatBubble align="left">
                    Perfect. We’ll make that the whole plan — not a moral referendum.
                  </ChatBubble>
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
              Holistic coaching loop
            </p>
            <h2 className="mt-3 font-serif text-4xl font-semibold leading-tight sm:text-6xl">
              The product breathes in context, then exhales a next step.
            </h2>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {capabilities.map((capability) => (
              <article
                key={capability.title}
                className="group rounded-[2rem] border border-white/65 bg-white/45 p-7 shadow-sm backdrop-blur transition hover:-translate-y-1 hover:shadow-xl hover:shadow-foreground/10"
              >
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-accent">
                  {capability.eyebrow}
                </p>
                <h3 className="mt-4 font-serif text-3xl font-semibold leading-tight">
                  {capability.title}
                </h3>
                <p className="mt-4 text-sm leading-7 text-muted-foreground">{capability.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="use-cases" className="px-5 py-16 sm:px-8 lg:px-12">
        <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.86fr_1.14fr] lg:items-start">
          <div className="rounded-[2.5rem] border border-foreground/10 bg-foreground p-8 text-background shadow-2xl shadow-foreground/10">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-background/70">
              Where it helps
            </p>
            <h2 className="mt-4 font-serif text-5xl font-semibold leading-tight">
              Built for people with more intent than bandwidth.
            </h2>
            <p className="mt-5 text-background/75">
              The fuzzy middle between productivity apps and therapy: a practical nudge, a softer
              plan, and a place that remembers what you said mattered.
            </p>
          </div>
          <div className="grid gap-4">
            {productMoments.map((moment, index) => (
              <div
                key={moment}
                className="flex gap-5 rounded-[2rem] border border-white/65 bg-white/50 p-6 shadow-sm backdrop-blur"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-foreground">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <p className="text-lg font-medium leading-8 text-foreground">{moment}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-5 py-16 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-7xl">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-accent">
              Doorways into calm
            </p>
            <h2 className="mt-3 font-serif text-4xl font-semibold leading-tight sm:text-5xl">
              Specific pages for the moments people actually search for.
            </h2>
            <p className="mt-5 text-lg leading-8 text-muted-foreground">
              Start with overwhelm, ADHD, depression, anxiety, wellness, career, menopause, or
              personal-assistant admin — each path ends in the same quiet room.
            </p>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {featurePages.map((page) => (
              <a
                key={page.topic}
                href={`/how-it-helps/${page.topic}`}
                className="rounded-[1.75rem] border border-white/65 bg-white/45 p-5 shadow-sm backdrop-blur transition hover:-translate-y-1 hover:border-accent hover:shadow-xl hover:shadow-foreground/10"
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
        <div className="mx-auto max-w-7xl rounded-[2.75rem] border border-white/65 bg-white/45 p-8 shadow-sm backdrop-blur sm:p-10 lg:p-12">
          <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.24em] text-accent">
                Trust by design
              </p>
              <h2 className="mt-3 font-serif text-4xl font-semibold leading-tight">
                Personal enough to be useful. Boundaried enough to feel safe.
              </h2>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2">
              {principles.map((principle) => (
                <li
                  key={principle}
                  className="rounded-3xl border border-border/70 bg-background/75 p-5 text-sm font-medium leading-7 text-muted-foreground"
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
          <p className="mx-auto mb-5 inline-flex rounded-full border border-white/70 bg-white/50 px-4 py-2 text-sm font-semibold text-foreground shadow-sm backdrop-blur">
            No grand reinvention required
          </p>
          <h2 className="font-serif text-5xl font-semibold leading-tight sm:text-7xl">
            Start with one honest sentence.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">
            Tell tranquil.coach what is on your mind. It will help you find the next grounded,
            doable move without asking you to become a different person first.
          </p>
          <a
            href="/chat"
            className="mt-8 inline-flex items-center justify-center rounded-full bg-foreground px-8 py-4 text-base font-semibold text-background shadow-lg shadow-foreground/10 transition hover:-translate-y-0.5 hover:bg-accent"
          >
            Open tranquil.coach
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
            ? 'max-w-[82%] rounded-[1.35rem] bg-background/15 px-4 py-3 text-sm leading-6 text-background'
            : 'max-w-[88%] rounded-[1.35rem] bg-background px-4 py-3 text-sm leading-6 text-foreground'
        }
      >
        {children}
      </p>
    </div>
  );
}
