import { Button } from '@lifecoach/ui';
import Link from 'next/link';

const proofPoints = [
  { value: '< 30 sec', label: 'to start talking with anonymous sign-in' },
  { value: '0 repeats', label: 'for facts you already shared' },
  { value: '1 place', label: 'for goals, calendar pressure, and next steps' },
];

const differentiators = [
  {
    title: 'Starts like a text from someone who knows you',
    description:
      'Short, warm replies replace corporate coaching scripts. Lifecoach remembers the useful bits, notices patterns, and picks up where the last conversation ended.',
  },
  {
    title: 'Grounded in the day you are actually having',
    description:
      'Local time, weather, goal progress, calendar density, and optional Google Workspace context are prepared before each answer, so the coach can be specific without interrogating you.',
  },
  {
    title: 'Turns reflection into movement',
    description:
      'The product nudges toward tiny commitments, tracks goal updates, and can help triage inbox, calendar, and tasks when you connect Workspace.',
  },
];

const useCases = [
  'Reset a spiraling morning before meetings begin.',
  'Turn vague ambition into one doable action today.',
  'Talk through tradeoffs without dumping context again.',
  'Review recent wins when motivation gets noisy.',
];

const trustItems = [
  'Anonymous first run; upgrade later without losing history.',
  'Browser-only location sharing. No IP-based geolocation.',
  'OAuth tokens stay server-side and are never shown to the model.',
];

export default function LandingPage() {
  return (
    <main className="min-h-screen overflow-hidden px-4 py-6 sm:px-6 lg:px-8">
      <section className="mx-auto flex w-full max-w-7xl flex-col gap-12 rounded-[2rem] border border-white/50 bg-[#fbf8f1]/70 px-5 py-5 shadow-2xl shadow-[#81715a]/10 backdrop-blur md:px-8 md:py-8 lg:min-h-[calc(100vh-3rem)]">
        <header className="flex items-center justify-between gap-4">
          <Link href="/" className="font-serif text-2xl font-semibold tracking-tight">
            Lifecoach
          </Link>
          <nav className="hidden items-center gap-6 text-sm font-medium text-muted-foreground md:flex">
            <a href="#why" className="hover:text-foreground">
              Why it works
            </a>
            <a href="#how" className="hover:text-foreground">
              How it helps
            </a>
            <a href="#trust" className="hover:text-foreground">
              Trust
            </a>
          </nav>
          <Button asChild size="md" className="shadow-lg shadow-[#7b9a86]/20">
            <Link href="/chat">Start free</Link>
          </Button>
        </header>

        <div className="grid flex-1 items-center gap-10 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="max-w-3xl space-y-8">
            <div className="inline-flex rounded-full border border-border bg-white/60 px-3 py-1 text-sm font-medium text-muted-foreground">
              AI life coaching that remembers the shape of your real life.
            </div>
            <div className="space-y-5">
              <h1 className="max-w-4xl text-balance font-serif text-5xl font-semibold leading-[0.95] tracking-[-0.04em] text-foreground sm:text-6xl lg:text-7xl">
                A calmer way to get unstuck, one conversation at a time.
              </h1>
              <p className="max-w-2xl text-pretty text-lg leading-8 text-muted-foreground sm:text-xl">
                Lifecoach is a warm conversational coach for the messy middle: goals, routines, hard
                days, crowded calendars, and the tiny next step you need more than another
                dashboard.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className="px-6 shadow-xl shadow-[#7b9a86]/20">
                <Link href="/chat">Talk to Lifecoach</Link>
              </Button>
              <Button asChild variant="subtle" size="lg" className="bg-white/40 px-6">
                <a href="#why">See the product</a>
              </Button>
            </div>
            <dl className="grid gap-3 sm:grid-cols-3">
              {proofPoints.map((point) => (
                <div key={point.value} className="rounded-3xl border border-border bg-white/45 p-4">
                  <dt className="font-serif text-3xl font-semibold text-foreground">
                    {point.value}
                  </dt>
                  <dd className="mt-1 text-sm leading-5 text-muted-foreground">{point.label}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="relative mx-auto w-full max-w-[520px]">
            <div className="absolute -left-6 top-10 h-40 w-40 rounded-full bg-accent/20 blur-3xl" />
            <div className="absolute -right-10 bottom-12 h-52 w-52 rounded-full bg-[#c67b63]/20 blur-3xl" />
            <div className="relative rounded-[2rem] border border-border bg-[#f7f0e6]/95 p-4 shadow-2xl shadow-[#6c5b44]/15">
              <div className="rounded-[1.5rem] bg-white/70 p-4">
                <div className="mb-5 flex items-center justify-between border-b border-border pb-3">
                  <div>
                    <p className="font-serif text-xl font-semibold">Today</p>
                    <p className="text-xs text-muted-foreground">
                      Context ready before the first reply
                    </p>
                  </div>
                  <span className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-foreground">
                    breathing
                  </span>
                </div>
                <div className="space-y-3">
                  <div className="mr-10 rounded-[1.4rem] bg-muted px-4 py-3 text-sm leading-6 text-foreground">
                    I keep saying I want to get healthy, but every day gets away from me.
                  </div>
                  <div className="ml-8 rounded-[1.4rem] bg-accent px-4 py-3 text-sm leading-6 text-accent-foreground">
                    Makes sense. Your calendar is stacked until 4, so let’s not pretend this needs a
                    huge plan. Want a 12-minute walk after your last meeting, or a kitchen reset
                    before lunch?
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-2 text-xs font-medium text-muted-foreground">
                    <div className="rounded-2xl border border-border bg-white/60 p-3">
                      Goal memory: energy
                    </div>
                    <div className="rounded-2xl border border-border bg-white/60 p-3">
                      Calendar: heavy PM
                    </div>
                    <div className="rounded-2xl border border-border bg-white/60 p-3">
                      Weather: clear later
                    </div>
                    <div className="rounded-2xl border border-border bg-white/60 p-3">
                      Tone: brief + kind
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="why" className="mx-auto grid max-w-7xl gap-4 px-1 py-16 md:grid-cols-3">
        {differentiators.map((item) => (
          <article
            key={item.title}
            className="rounded-[1.75rem] border border-border bg-[#fbf8f1]/70 p-6 shadow-lg shadow-[#81715a]/5"
          >
            <h2 className="font-serif text-2xl font-semibold leading-tight">{item.title}</h2>
            <p className="mt-4 text-sm leading-7 text-muted-foreground">{item.description}</p>
          </article>
        ))}
      </section>

      <section
        id="how"
        className="mx-auto grid max-w-7xl gap-8 rounded-[2rem] border border-border bg-[#2f3b34] p-6 text-accent-foreground md:grid-cols-[0.9fr_1.1fr] md:p-10"
      >
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#d6dfd3]">
            Built for the in-between moments
          </p>
          <h2 className="mt-3 max-w-xl font-serif text-4xl font-semibold leading-tight">
            Not therapy. Not productivity theater. A practical companion for the next honest step.
          </h2>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2">
          {useCases.map((useCase) => (
            <li
              key={useCase}
              className="rounded-3xl border border-white/15 bg-white/10 p-4 text-sm leading-6"
            >
              {useCase}
            </li>
          ))}
        </ul>
      </section>

      <section
        id="trust"
        className="mx-auto grid max-w-7xl gap-8 px-1 py-16 md:grid-cols-[0.8fr_1.2fr]"
      >
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Trust by design
          </p>
          <h2 className="mt-3 font-serif text-4xl font-semibold leading-tight">
            Personal context without creepy shortcuts.
          </h2>
        </div>
        <div className="grid gap-3">
          {trustItems.map((item) => (
            <div
              key={item}
              className="rounded-3xl border border-border bg-white/45 p-4 text-sm font-medium text-foreground"
            >
              {item}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
