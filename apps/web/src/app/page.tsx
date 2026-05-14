import type { ReactNode } from 'react';
import { featurePages } from '../lib/marketing/feature-pages';

const rituals = [
  {
    time: '08:10',
    title: 'Arrive gently',
    body: 'A plan that notices weather, meetings, energy, and the one promise you made to yourself.',
  },
  {
    time: '13:40',
    title: 'Untangle the pile',
    body: 'Inbox, calendar, task list, and vague dread become a short menu of doable next moves.',
  },
  {
    time: '21:05',
    title: 'Close the loop',
    body: 'Capture wins, name what was hard, and leave tomorrow a humane handoff instead of a guilt stack.',
  },
];

const capabilities = [
  {
    icon: '◐',
    title: 'Context that feels like care',
    body: 'Tranquil can blend time of day, weather, location you explicitly share, goals, and recent progress so advice begins with your actual day — not a generic routine.',
  },
  {
    icon: '✧',
    title: 'Memory with manners',
    body: 'Priorities, routines, dislikes, recurring blockers, and little preferences compound into coaching that feels continuous without turning you into a dataset.',
  },
  {
    icon: '⌁',
    title: 'Admin without the shame spiral',
    body: 'When you connect Google Workspace, email, calendar, and tasks can be reasoned about in the app layer while OAuth tokens stay away from the model.',
  },
];

const proofPoints = [
  { value: '0', label: 'setup steps before first relief' },
  { value: '3', label: 'tiny moves instead of a giant plan' },
  { value: '24/7', label: 'a calm thread waiting when life spikes' },
];

const principles = [
  'Short, warm replies — no corporate life-hack lectures.',
  'Browser-only location sharing; no IP geolocation fallback.',
  'Workspace OAuth tokens stay in the app layer and never go to the model.',
  'Clear boundaries: planning support, not therapy, diagnosis, or emergency care.',
];

const sensoryCues = ['soft focus', 'kind sequencing', 'quiet memory', 'bounded action'];

export default function LandingPage() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#f7f0e6] text-foreground">
      <section className="relative px-5 py-6 sm:px-8 lg:px-12">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_16%_12%,rgba(128,100,210,0.18),transparent_28%),radial-gradient(circle_at_82%_18%,rgba(72,151,130,0.2),transparent_30%),radial-gradient(circle_at_52%_70%,rgba(230,156,102,0.18),transparent_34%)]" />
        <div className="absolute left-1/2 top-28 -z-10 h-[34rem] w-[34rem] -translate-x-1/2 rounded-full border border-white/60 bg-white/20 blur-3xl" />

        <nav className="mx-auto flex max-w-7xl items-center justify-between rounded-full border border-white/70 bg-white/55 px-4 py-3 shadow-[0_20px_80px_rgba(47,59,52,0.08)] backdrop-blur-xl">
          <a href="/" className="group flex items-center gap-3 text-foreground">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-foreground text-lg text-background shadow-inner">
              ◒
            </span>
            <span className="font-serif text-2xl font-semibold tracking-tight">tranquil.coach</span>
          </a>
          <div className="hidden items-center gap-6 text-sm font-semibold text-muted-foreground md:flex">
            <a href="#ritual" className="transition hover:text-foreground">
              Ritual
            </a>
            <a href="#product" className="transition hover:text-foreground">
              Product
            </a>
            <a href="#use-cases" className="transition hover:text-foreground">
              Use cases
            </a>
            <a href="/blog" className="transition hover:text-foreground">
              Field notes
            </a>
          </div>
          <a
            href="/chat"
            className="rounded-full bg-foreground px-5 py-2.5 text-sm font-semibold text-background shadow-sm transition hover:-translate-y-0.5 hover:bg-accent"
          >
            Begin gently
          </a>
        </nav>

        <div className="mx-auto grid max-w-7xl gap-12 pb-16 pt-14 lg:grid-cols-[1.02fr_0.98fr] lg:items-center lg:pb-24 lg:pt-24">
          <div>
            <p className="mb-5 inline-flex rounded-full border border-white/70 bg-white/55 px-4 py-2 text-sm font-bold text-foreground shadow-sm backdrop-blur">
              AI coaching for the overloaded nervous system
            </p>
            <h1 className="max-w-4xl text-balance font-serif text-6xl font-semibold leading-[0.96] tracking-[-0.045em] text-foreground sm:text-7xl lg:text-8xl">
              Find the next calm thing.
            </h1>
            <p className="mt-7 max-w-2xl text-pretty text-lg leading-8 text-muted-foreground sm:text-xl">
              Tranquil is a warm, context-aware companion for ADHD, burnout, anxiety,
              peri/menopause, low-motivation days, new-parent fog, and the ordinary admin pile of
              modern life. It turns the swirl into one humane next step — and remembers what helps.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a
                href="/chat"
                className="inline-flex items-center justify-center rounded-full bg-foreground px-7 py-4 text-base font-semibold text-background shadow-xl shadow-foreground/10 transition hover:-translate-y-0.5 hover:bg-accent"
              >
                Try Tranquil free
              </a>
              <a
                href="#product"
                className="inline-flex items-center justify-center rounded-full border border-white/70 bg-white/45 px-7 py-4 text-base font-semibold text-foreground shadow-sm backdrop-blur transition hover:-translate-y-0.5 hover:border-accent"
              >
                See how it works
              </a>
            </div>
            <dl className="mt-10 grid max-w-2xl grid-cols-3 gap-3">
              {proofPoints.map((point) => (
                <div
                  key={point.label}
                  className="rounded-[1.75rem] border border-white/70 bg-white/45 p-4 shadow-sm backdrop-blur"
                >
                  <dt className="font-serif text-3xl font-semibold text-foreground">
                    {point.value}
                  </dt>
                  <dd className="mt-1 text-xs font-medium leading-5 text-muted-foreground">
                    {point.label}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="relative">
            <div className="absolute -right-8 -top-10 h-36 w-36 rounded-full bg-[#8064d2]/20 blur-3xl" />
            <div className="relative rounded-[2.5rem] border border-white/75 bg-white/45 p-3 shadow-[0_35px_120px_rgba(47,59,52,0.16)] backdrop-blur-xl">
              <div className="rounded-[2rem] bg-[#fcf8f1] p-5">
                <div className="flex items-start justify-between gap-4 border-b border-border/60 pb-5">
                  <div>
                    <p className="text-sm font-bold uppercase tracking-[0.24em] text-accent">
                      live calm map
                    </p>
                    <p className="mt-2 font-serif text-3xl font-semibold">Today with Tranquil</p>
                  </div>
                  <span className="rounded-full bg-[#e9ddff] px-3 py-1 text-xs font-bold text-foreground">
                    gentle mode
                  </span>
                </div>
                <div className="grid gap-4 py-5">
                  <ChatBubble align="left">
                    Good morning. Three meetings, rain after lunch, and your launch review matters
                    most. Want a plan that protects the hard thinking before noon?
                  </ChatBubble>
                  <ChatBubble align="right">
                    Yes. I also need to answer Mara and move my body without making today bigger.
                  </ChatBubble>
                  <ChatBubble align="left">
                    Beautiful. First: 35 quiet minutes on the review. Then I’ll help draft Mara’s
                    reply. Movement becomes a ten-minute walk in the dry window at 5:20.
                  </ChatBubble>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  {sensoryCues.map((cue) => (
                    <div
                      key={cue}
                      className="rounded-2xl border border-border/70 bg-white/70 px-3 py-3 text-center text-sm font-bold text-foreground"
                    >
                      {cue}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="ritual" className="px-5 py-16 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-7xl rounded-[3rem] border border-white/70 bg-foreground p-8 text-background shadow-2xl shadow-foreground/10 sm:p-10 lg:p-12">
          <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-end">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.28em] text-background/60">
                The ritual
              </p>
              <h2 className="mt-4 max-w-xl font-serif text-4xl font-semibold leading-tight sm:text-5xl">
                A product that behaves less like a dashboard and more like a deep breath.
              </h2>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {rituals.map((ritual) => (
                <article key={ritual.title} className="rounded-[2rem] bg-background/10 p-5">
                  <p className="font-serif text-3xl font-semibold text-background">{ritual.time}</p>
                  <h3 className="mt-4 text-lg font-bold text-background">{ritual.title}</h3>
                  <p className="mt-3 text-sm leading-6 text-background/70">{ritual.body}</p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="product" className="px-5 py-16 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-7xl">
          <div className="max-w-3xl">
            <p className="text-sm font-bold uppercase tracking-[0.24em] text-accent">
              Product thesis
            </p>
            <h2 className="mt-3 font-serif text-4xl font-semibold leading-tight sm:text-6xl">
              Coaching gets better when it can see the pattern and still choose kindness.
            </h2>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {capabilities.map((capability) => (
              <article
                key={capability.title}
                className="group rounded-[2.25rem] border border-white/70 bg-white/50 p-7 shadow-sm backdrop-blur transition hover:-translate-y-1 hover:shadow-xl hover:shadow-foreground/10"
              >
                <span className="grid h-12 w-12 place-items-center rounded-full bg-foreground font-serif text-2xl text-background transition group-hover:rotate-12">
                  {capability.icon}
                </span>
                <h3 className="mt-6 font-serif text-2xl font-semibold leading-tight">
                  {capability.title}
                </h3>
                <p className="mt-4 text-sm leading-7 text-muted-foreground">{capability.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="use-cases" className="px-5 py-16 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
            <div className="max-w-3xl">
              <p className="text-sm font-bold uppercase tracking-[0.24em] text-accent">
                Doorways in
              </p>
              <h2 className="mt-3 font-serif text-4xl font-semibold leading-tight sm:text-6xl">
                Specific help for the moments people actually search for.
              </h2>
            </div>
            <a
              href="/how-it-helps"
              className="inline-flex w-fit items-center justify-center rounded-full border border-border bg-white/55 px-6 py-3 text-sm font-bold text-foreground shadow-sm backdrop-blur transition hover:-translate-y-0.5 hover:border-accent"
            >
              Explore all pages
            </a>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {featurePages.map((page, index) => (
              <a
                key={page.topic}
                href={`/how-it-helps/${page.topic}`}
                className="group relative min-h-64 overflow-hidden rounded-[2rem] border border-white/70 bg-white/50 p-6 shadow-sm backdrop-blur transition hover:-translate-y-1 hover:shadow-xl hover:shadow-foreground/10"
              >
                <span className="absolute right-5 top-5 font-serif text-5xl text-accent/20">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <p className="max-w-[75%] text-xs font-bold uppercase tracking-[0.18em] text-accent">
                  {page.audience}
                </p>
                <h3 className="mt-8 font-serif text-2xl font-semibold leading-tight text-foreground">
                  {page.title}
                </h3>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">{page.description}</p>
                <span className="mt-6 inline-flex text-sm font-bold text-foreground transition group-hover:translate-x-1">
                  Open doorway →
                </span>
              </a>
            ))}
          </div>
        </div>
      </section>

      <section id="privacy" className="px-5 py-16 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-7xl rounded-[3rem] border border-white/70 bg-[#fcf8f1]/80 p-8 shadow-sm backdrop-blur sm:p-10 lg:p-12">
          <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.24em] text-accent">
                Trust by design
              </p>
              <h2 className="mt-3 font-serif text-4xl font-semibold leading-tight">
                Personal enough to help. Boundaried enough to feel safe.
              </h2>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2">
              {principles.map((principle) => (
                <li
                  key={principle}
                  className="rounded-3xl border border-border/70 bg-white/65 p-5 text-sm font-semibold leading-7 text-muted-foreground"
                >
                  <span className="mr-2 text-accent">✦</span>
                  {principle}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="px-5 pb-24 pt-10 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-4xl text-center">
          <p className="mx-auto mb-5 w-fit rounded-full border border-white/70 bg-white/50 px-4 py-2 text-sm font-bold text-foreground shadow-sm backdrop-blur">
            tranquil.coach
          </p>
          <h2 className="font-serif text-5xl font-semibold leading-tight tracking-tight sm:text-7xl">
            Start with one honest sentence.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">
            Tell Tranquil what is on your mind today. It will help you find the next grounded,
            doable move without asking you to become a different person first.
          </p>
          <a
            href="/chat"
            className="mt-8 inline-flex items-center justify-center rounded-full bg-foreground px-8 py-4 text-base font-semibold text-background shadow-lg shadow-foreground/10 transition hover:-translate-y-0.5 hover:bg-accent"
          >
            Open Tranquil
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
            ? 'max-w-[84%] rounded-[1.35rem] bg-accent px-4 py-3 text-sm leading-6 text-accent-foreground shadow-sm'
            : 'max-w-[88%] rounded-[1.35rem] bg-muted px-4 py-3 text-sm leading-6 text-foreground shadow-sm'
        }
      >
        {children}
      </p>
    </div>
  );
}
