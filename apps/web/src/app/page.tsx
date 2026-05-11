import { ChatWindow } from '../components/ChatWindow';

const proofPoints = [
  'Anonymous first run',
  'Local context when you allow it',
  'Memory across sessions',
  'Google Workspace-ready',
];

const productPillars = [
  {
    eyebrow: 'Reflect',
    title: 'A calm place to untangle the day',
    body: 'Start with a messy thought, a difficult morning, or a tiny win. Lifecoach mirrors it back in plain language and helps you name the next humane step.',
  },
  {
    eyebrow: 'Remember',
    title: 'Continuity without the recap tax',
    body: "The coach can remember goals, preferences, family details, and recurring patterns, so each session picks up from the life you're already living.",
  },
  {
    eyebrow: 'Act',
    title: 'Gentle accountability that meets your calendar',
    body: 'With permission, Lifecoach can understand your local context and Workspace rhythm, then turn intentions into grounded plans instead of abstract advice.',
  },
];

const moments = [
  'Plan a calmer morning before the day gets loud.',
  'Debrief a meeting without spiraling or over-editing yourself.',
  'Choose one small action when your list feels impossible.',
  'Notice patterns in sleep, mood, focus, and follow-through.',
];

const principles = [
  {
    title: 'Permissioned context',
    body: 'Location, calendar, inbox, and task context are opt-in. If you decline, the coach still works with what you share in the conversation.',
  },
  {
    title: 'Warm over performative',
    body: 'Short, conversational replies are the product standard: less corporate pep talk, more useful friend who knows when to pause.',
  },
  {
    title: 'Privacy-conscious by design',
    body: 'OAuth tokens stay out of model prompts, and browser geolocation is used only when you choose to share it.',
  },
];

const chatPreview = [
  {
    from: 'You',
    text: "I'm overwhelmed and have 25 minutes before school pickup.",
  },
  {
    from: 'Lifecoach',
    text: 'Okay — tiny reset. Drink water, move the laundry to the dryer, then write the one email subject line. That counts.',
  },
  {
    from: 'You',
    text: 'Can you remember that mornings go better when I prep lunches at night?',
  },
];

export const metadata = {
  title: 'Lifecoach — an AI coach for the life between meetings',
  description:
    'A warm AI life coach that remembers your goals, understands your day with permission, and helps you choose the next small step.',
};

export default function HomePage() {
  return (
    <>
      <MarketingLanding />
      <section id="coach" aria-label="Try Lifecoach" className="scroll-mt-8">
        <ChatWindow />
      </section>
    </>
  );
}

function MarketingLanding() {
  return (
    <div id="top" className="relative isolate overflow-hidden px-4 py-6 sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 mx-auto h-[560px] max-w-7xl rounded-b-[48px] bg-[radial-gradient(circle_at_20%_20%,rgba(123,154,134,0.28),transparent_32%),radial-gradient(circle_at_80%_10%,rgba(198,123,99,0.18),transparent_32%),linear-gradient(135deg,rgba(255,255,255,0.42),rgba(236,228,215,0.24))]" />
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 py-3">
        <a href="#top" className="flex items-center gap-3" aria-label="Lifecoach home">
          <span className="flex size-10 items-center justify-center rounded-full border border-border bg-background/80 font-serif text-xl font-semibold shadow-sm">
            L
          </span>
          <span className="font-serif text-2xl font-semibold tracking-tight">Lifecoach</span>
        </a>
        <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
          <a href="#why" className="transition hover:text-foreground">
            Why it works
          </a>
          <a href="#moments" className="transition hover:text-foreground">
            Moments
          </a>
          <a href="#trust" className="transition hover:text-foreground">
            Trust
          </a>
        </nav>
        <a
          href="#coach"
          className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-foreground shadow-sm transition hover:opacity-90"
        >
          Start now
        </a>
      </header>

      <div className="mx-auto max-w-6xl pt-14 pb-20 sm:pt-20 lg:pb-28">
        <section className="grid items-center gap-12 lg:grid-cols-[1.04fr_0.96fr]">
          <div>
            <div className="inline-flex rounded-full border border-border bg-background/70 px-3 py-1 text-sm font-medium text-muted-foreground shadow-sm backdrop-blur">
              AI coaching for the life between meetings
            </div>
            <h1 className="mt-6 max-w-3xl font-serif text-5xl font-semibold leading-[0.96] tracking-[-0.045em] text-foreground sm:text-6xl lg:text-7xl">
              A coach that remembers you, not just the chat.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground sm:text-xl">
              Lifecoach is a warm, conversational AI companion for turning overwhelmed days into
              small next steps. It can remember your goals, understand your real-world context when
              you allow it, and help you keep promises to yourself without turning your life into a
              productivity spreadsheet.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a
                href="#coach"
                className="inline-flex items-center justify-center rounded-full bg-accent px-6 py-3 text-base font-semibold text-accent-foreground shadow-sm transition hover:opacity-90"
              >
                Try the coach
              </a>
              <a
                href="#why"
                className="inline-flex items-center justify-center rounded-full border border-border bg-background/40 px-6 py-3 text-base font-semibold text-foreground transition hover:border-foreground"
              >
                See how it helps
              </a>
            </div>
            <div className="mt-8 flex flex-wrap gap-2">
              {proofPoints.map((point) => (
                <span
                  key={point}
                  className="rounded-full border border-border bg-background/60 px-3 py-1 text-sm text-muted-foreground"
                >
                  {point}
                </span>
              ))}
            </div>
          </div>

          <div className="rounded-[36px] border border-border bg-background/72 p-3 shadow-2xl shadow-[#2f3b34]/10 backdrop-blur">
            <div className="rounded-[28px] border border-border bg-[#fbf8f1]/88 p-5">
              <div className="mb-5 flex items-center justify-between border-b border-border pb-4">
                <div>
                  <p className="font-serif text-2xl font-semibold tracking-tight">Today</p>
                  <p className="text-sm text-muted-foreground">A grounded plan in under a minute</p>
                </div>
                <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                  gentle mode
                </span>
              </div>
              <div className="space-y-3">
                {chatPreview.map((message) => (
                  <div
                    key={`${message.from}-${message.text}`}
                    className={
                      message.from === 'You'
                        ? 'ml-8 rounded-[22px] bg-accent px-4 py-3 text-sm leading-6 text-accent-foreground'
                        : 'mr-8 rounded-[22px] border border-border bg-background px-4 py-3 text-sm leading-6 text-foreground shadow-sm'
                    }
                  >
                    <p className="mb-1 text-xs font-semibold opacity-70">{message.from}</p>
                    <p>{message.text}</p>
                  </div>
                ))}
              </div>
              <div className="mt-5 rounded-2xl bg-muted/70 p-4 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">Remembered:</span> mornings are easier
                when lunches are prepped the night before.
              </div>
            </div>
          </div>
        </section>

        <section id="why" className="mt-20 grid gap-4 md:grid-cols-3">
          {productPillars.map((pillar) => (
            <article
              key={pillar.title}
              className="rounded-[28px] border border-border bg-background/62 p-6 shadow-sm backdrop-blur"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-accent">
                {pillar.eyebrow}
              </p>
              <h2 className="mt-4 font-serif text-2xl font-semibold tracking-tight">
                {pillar.title}
              </h2>
              <p className="mt-3 text-sm leading-7 text-muted-foreground">{pillar.body}</p>
            </article>
          ))}
        </section>

        <section
          id="moments"
          className="mt-20 grid gap-8 rounded-[36px] border border-border bg-[#fbf8f1]/62 p-6 shadow-sm backdrop-blur lg:grid-cols-[0.9fr_1.1fr] lg:p-8"
        >
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-accent">
              Where Lifecoach fits
            </p>
            <h2 className="mt-3 font-serif text-4xl font-semibold leading-tight tracking-tight">
              Not therapy. Not a task manager. The connective tissue between intention and action.
            </h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {moments.map((moment) => (
              <div key={moment} className="rounded-3xl border border-border bg-background/70 p-5">
                <p className="text-sm leading-7 text-foreground">{moment}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="trust" className="mt-20 grid gap-4 md:grid-cols-3">
          {principles.map((principle) => (
            <article key={principle.title} className="rounded-3xl border border-border p-6">
              <h2 className="font-serif text-2xl font-semibold tracking-tight">
                {principle.title}
              </h2>
              <p className="mt-3 text-sm leading-7 text-muted-foreground">{principle.body}</p>
            </article>
          ))}
        </section>
      </div>
    </div>
  );
}
