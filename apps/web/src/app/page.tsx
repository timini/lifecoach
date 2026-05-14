import type { ReactNode } from 'react';
import { featurePages } from '../lib/marketing/feature-pages';

const constellations = [
  { label: 'Weather', value: 'rain at 2', angle: 'rotate-[-7deg]' },
  { label: 'Calendar', value: '3 meetings', angle: 'rotate-[4deg]' },
  { label: 'Energy', value: 'gentle start', angle: 'rotate-[-2deg]' },
  { label: 'Memory', value: 'protect launch work', angle: 'rotate-[6deg]' },
];

const rituals = [
  {
    time: '08:10',
    title: 'A plan that meets the morning',
    body: 'tranquil.coach blends calendar pressure, weather, goals, and your actual bandwidth into one calm first move.',
  },
  {
    time: '13:30',
    title: 'Admin becomes a conversation',
    body: 'Inbox threads, tasks, and calendar moves get sorted into reply, schedule, park, or let go — without the shame spiral.',
  },
  {
    time: '21:05',
    title: 'The day lands softly',
    body: 'A short reflection captures wins, patterns, and tomorrow’s kinder constraint so momentum compounds without streak anxiety.',
  },
];

const designPrinciples = [
  'Short, warm, human replies — no corporate life-hack essays.',
  'Browser-only location sharing; no IP geolocation fallbacks.',
  'Workspace OAuth tokens stay in the app layer and never go to the model.',
  'Built for executive-function reality: ADHD, burnout, anxiety, low energy, peri/menopause, and modern admin overload.',
];

const proofPoints = [
  { value: '1', label: 'honest sentence to begin' },
  { value: '0', label: 'productivity systems to maintain' },
  { value: '24/7', label: 'thread of context when the day changes' },
];

export default function LandingPage() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#f7efe3] text-foreground">
      <section className="relative px-5 py-5 sm:px-8 lg:px-12">
        <AmbientBackdrop />
        <MarketingNav />

        <div className="mx-auto grid max-w-7xl gap-12 pb-16 pt-14 lg:grid-cols-[1.02fr_0.98fr] lg:items-center lg:pb-24 lg:pt-24">
          <div className="relative z-10">
            <p className="mb-6 inline-flex rounded-full border border-white/70 bg-white/45 px-4 py-2 text-sm font-semibold text-foreground shadow-sm backdrop-blur-xl">
              The calm operating layer for a life with too many tabs
            </p>
            <h1 className="max-w-5xl text-balance font-serif text-6xl font-semibold leading-[0.92] tracking-tight text-foreground sm:text-7xl lg:text-8xl">
              Meet the softest way through a loud day.
            </h1>
            <p className="mt-7 max-w-2xl text-pretty text-lg leading-8 text-[#59665d] sm:text-xl">
              tranquil.coach is a beautiful, context-aware AI companion for the messy middle between
              productivity apps and therapy. It remembers what matters, reads the room, and turns
              overwhelm into one humane next step.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <a
                href="/chat"
                className="group inline-flex items-center justify-center rounded-full bg-[#24362d] px-7 py-4 text-base font-semibold text-[#fff8ec] shadow-2xl shadow-[#24362d]/20 transition hover:-translate-y-0.5 hover:bg-[#7c6552]"
                data-analytics-event="landing_cta_click"
                data-analytics-label="hero_try_free"
              >
                Start a calmer thread
                <span className="ml-2 transition group-hover:translate-x-1">→</span>
              </a>
              <a
                href="#how-it-works"
                className="inline-flex items-center justify-center rounded-full border border-white/70 bg-white/45 px-7 py-4 text-base font-semibold text-foreground shadow-sm backdrop-blur-xl transition hover:-translate-y-0.5 hover:border-[#d98f79]"
                data-analytics-event="landing_cta_click"
                data-analytics-label="hero_see_product"
              >
                See the redesign
              </a>
            </div>
            <dl className="mt-10 grid max-w-2xl gap-3 sm:grid-cols-3">
              {proofPoints.map((point) => (
                <div
                  key={point.label}
                  className="rounded-[1.75rem] border border-white/70 bg-white/45 p-5 shadow-sm backdrop-blur-xl"
                >
                  <dt className="font-serif text-4xl font-semibold text-foreground">
                    {point.value}
                  </dt>
                  <dd className="mt-1 text-xs font-medium leading-5 text-[#647168]">
                    {point.label}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="relative min-h-[620px]">
            <div className="absolute left-1/2 top-1/2 h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/60 bg-[radial-gradient(circle,#fff8ec_0%,#f5dbc8_38%,#b7d1bf_72%,transparent_73%)] opacity-80 shadow-2xl shadow-[#304a3a]/10" />
            <div className="absolute left-1/2 top-1/2 h-[390px] w-[390px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#24362d]/10" />
            {constellations.map((item, index) => (
              <div
                key={item.label}
                className={`absolute rounded-[1.4rem] border border-white/70 bg-white/55 px-4 py-3 shadow-xl shadow-[#304a3a]/10 backdrop-blur-xl ${item.angle} ${orbitPosition(index)}`}
              >
                <p className="text-[0.65rem] font-bold uppercase tracking-[0.2em] text-[#c87761]">
                  {item.label}
                </p>
                <p className="mt-1 font-serif text-xl font-semibold text-foreground">
                  {item.value}
                </p>
              </div>
            ))}
            <div className="absolute left-1/2 top-1/2 w-[min(92vw,430px)] -translate-x-1/2 -translate-y-1/2 rounded-[2.4rem] border border-white/70 bg-[#fffaf1]/85 p-4 shadow-2xl shadow-[#24362d]/20 backdrop-blur-2xl">
              <div className="rounded-[1.9rem] border border-[#ead9c8] bg-[#fdf6eb] p-5">
                <div className="flex items-start justify-between gap-4 border-b border-[#ead9c8] pb-4">
                  <div>
                    <p className="text-sm font-bold uppercase tracking-[0.22em] text-[#c87761]">
                      tranquil thread
                    </p>
                    <p className="mt-1 font-serif text-3xl font-semibold leading-none">
                      Today, softened
                    </p>
                  </div>
                  <span className="rounded-full bg-[#d9eadc] px-3 py-1 text-xs font-bold text-[#304a3a]">
                    live context
                  </span>
                </div>
                <div className="space-y-4 py-5">
                  <ChatBubble align="left">
                    Good morning. Your focus window is before lunch, rain arrives at 2, and Mara’s
                    thread is the only message that needs courage. Want a plan with fewer edges?
                  </ChatBubble>
                  <ChatBubble align="right">
                    Yes. I have the launch review and I feel behind.
                  </ChatBubble>
                  <ChatBubble align="left">
                    Then we protect 45 minutes for the review, draft Mara without sending yet, and
                    move the workout to the dry pocket at 5. Nothing else earns urgency right now.
                  </ChatBubble>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  {['Soften plan', 'Draft reply', 'Close loop'].map((action) => (
                    <button
                      key={action}
                      type="button"
                      className="rounded-2xl border border-[#ead9c8] bg-white/55 px-3 py-3 text-sm font-semibold text-foreground transition hover:-translate-y-0.5 hover:border-[#c87761]"
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
        <div className="mx-auto max-w-7xl rounded-[3rem] border border-white/70 bg-white/40 p-6 shadow-sm backdrop-blur-xl sm:p-10 lg:p-12">
          <div className="grid gap-10 lg:grid-cols-[0.82fr_1.18fr] lg:items-end">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.24em] text-[#c87761]">
                Product ritual
              </p>
              <h2 className="mt-3 font-serif text-5xl font-semibold leading-[0.98] sm:text-6xl">
                Not another dashboard. A room where the day gets quieter.
              </h2>
            </div>
            <p className="text-lg leading-8 text-[#59665d]">
              The redesign reframes tranquil.coach as a sensory, trustable companion: ambient
              context, tiny decisions, and a warm memory layer that helps people act without feeling
              managed.
            </p>
          </div>
          <div className="mt-10 grid gap-4 lg:grid-cols-3">
            {rituals.map((ritual) => (
              <article
                key={ritual.title}
                className="rounded-[2rem] border border-white/70 bg-[#fffaf1]/70 p-7 shadow-sm"
              >
                <p className="font-serif text-4xl font-semibold text-[#c87761]">{ritual.time}</p>
                <h3 className="mt-5 font-serif text-3xl font-semibold leading-tight">
                  {ritual.title}
                </h3>
                <p className="mt-4 text-sm leading-7 text-[#647168]">{ritual.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="use-cases" className="px-5 py-16 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-7xl">
          <div className="max-w-3xl">
            <p className="text-sm font-bold uppercase tracking-[0.24em] text-[#c87761]">Ways in</p>
            <h2 className="mt-3 font-serif text-5xl font-semibold leading-[0.98] sm:text-6xl">
              Specific doors for very human stuck points.
            </h2>
            <p className="mt-5 text-lg leading-8 text-[#59665d]">
              Each product page now feels like a calm landing room for the exact phrase someone is
              searching when they have no spare executive function.
            </p>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {featurePages.map((page, index) => (
              <a
                key={page.topic}
                href={`/how-it-helps/${page.topic}`}
                className="group relative min-h-[260px] overflow-hidden rounded-[2rem] border border-white/70 bg-[#fffaf1]/70 p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-2xl hover:shadow-[#24362d]/10"
              >
                <div
                  className={`absolute -right-10 -top-10 h-32 w-32 rounded-full blur-2xl ${cardGlow(index)}`}
                />
                <p className="relative text-xs font-bold uppercase tracking-[0.18em] text-[#c87761]">
                  {page.audience}
                </p>
                <h3 className="relative mt-4 font-serif text-3xl font-semibold leading-tight text-foreground">
                  {page.title}
                </h3>
                <p className="relative mt-4 text-sm leading-6 text-[#647168]">{page.description}</p>
                <span className="absolute bottom-5 left-6 text-sm font-bold text-foreground opacity-0 transition group-hover:opacity-100">
                  Enter room →
                </span>
              </a>
            ))}
          </div>
        </div>
      </section>

      <section id="privacy" className="px-5 py-16 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-7xl overflow-hidden rounded-[3rem] bg-[#24362d] p-8 text-[#fff8ec] shadow-2xl shadow-[#24362d]/20 sm:p-10 lg:p-12">
          <div className="grid gap-10 lg:grid-cols-[0.85fr_1.15fr]">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.24em] text-[#f2b09d]">
                Trust by design
              </p>
              <h2 className="mt-3 font-serif text-5xl font-semibold leading-[0.98]">
                Intimate enough to help. Boundaried enough to exhale.
              </h2>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2">
              {designPrinciples.map((principle) => (
                <li
                  key={principle}
                  className="rounded-[1.6rem] border border-white/10 bg-white/[0.08] p-5 text-sm font-medium leading-7 text-[#fff8ec]/78"
                >
                  <span className="mr-2 text-[#f2b09d]">✦</span>
                  {principle}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="px-5 pb-24 pt-10 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-4xl text-center">
          <p className="mx-auto mb-5 inline-flex rounded-full border border-white/70 bg-white/45 px-4 py-2 text-sm font-semibold text-foreground shadow-sm backdrop-blur-xl">
            tranquil.coach
          </p>
          <h2 className="font-serif text-5xl font-semibold leading-[0.98] sm:text-7xl">
            Begin with the truth. We’ll make it doable.
          </h2>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-[#59665d]">
            Tell tranquil.coach what is on your mind today. It will help you find the next grounded
            move without asking you to become a different person first.
          </p>
          <a
            href="/chat"
            className="mt-9 inline-flex items-center justify-center rounded-full bg-[#24362d] px-8 py-4 text-base font-semibold text-[#fff8ec] shadow-2xl shadow-[#24362d]/20 transition hover:-translate-y-0.5 hover:bg-[#7c6552]"
            data-analytics-event="landing_cta_click"
            data-analytics-label="footer_open_lifecoach"
          >
            Open tranquil.coach
          </a>
        </div>
      </section>
    </main>
  );
}

function MarketingNav() {
  return (
    <nav className="mx-auto flex max-w-7xl items-center justify-between rounded-full border border-white/70 bg-white/45 px-4 py-3 shadow-sm backdrop-blur-xl">
      <a
        href="/"
        className="font-serif text-2xl font-semibold tracking-tight text-foreground"
        data-analytics-event="landing_nav_home"
        data-analytics-label="logo"
      >
        tranquil.coach
      </a>
      <div className="hidden items-center gap-6 text-sm font-semibold text-[#647168] md:flex">
        <a
          href="#how-it-works"
          className="transition hover:text-foreground"
          data-analytics-event="landing_nav_section"
          data-analytics-label="how_it_works"
        >
          Ritual
        </a>
        <a
          href="#use-cases"
          className="transition hover:text-foreground"
          data-analytics-event="landing_nav_section"
          data-analytics-label="use_cases"
        >
          Use cases
        </a>
        <a
          href="#privacy"
          className="transition hover:text-foreground"
          data-analytics-event="landing_nav_section"
          data-analytics-label="privacy"
        >
          Trust
        </a>
        <a
          href="/blog"
          className="transition hover:text-foreground"
          data-analytics-event="landing_nav_section"
          data-analytics-label="blog"
        >
          Blog
        </a>
      </div>
      <a
        href="/chat"
        className="rounded-full bg-[#24362d] px-5 py-2.5 text-sm font-semibold text-[#fff8ec] shadow-sm transition hover:-translate-y-0.5 hover:bg-[#7c6552]"
        data-analytics-event="landing_cta_click"
        data-analytics-label="nav_start_coaching"
      >
        Start coaching
      </a>
    </nav>
  );
}

function AmbientBackdrop() {
  return (
    <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div className="absolute -left-24 top-6 h-80 w-80 rounded-full bg-[#f2b09d]/45 blur-3xl" />
      <div className="absolute right-0 top-20 h-96 w-96 rounded-full bg-[#a8cbb3]/55 blur-3xl" />
      <div className="absolute left-1/3 top-[420px] h-72 w-72 rounded-full bg-[#f4d690]/35 blur-3xl" />
    </div>
  );
}

function ChatBubble({ children, align }: { children: ReactNode; align: 'left' | 'right' }) {
  return (
    <div className={align === 'right' ? 'flex justify-end' : 'flex justify-start'}>
      <p
        className={
          align === 'right'
            ? 'max-w-[82%] rounded-[1.35rem] bg-[#d98f79] px-4 py-3 text-sm leading-6 text-white'
            : 'max-w-[88%] rounded-[1.35rem] bg-white/80 px-4 py-3 text-sm leading-6 text-foreground shadow-sm'
        }
      >
        {children}
      </p>
    </div>
  );
}

function orbitPosition(index: number) {
  return [
    'left-2 top-20 sm:left-8',
    'right-0 top-8 sm:right-8',
    'bottom-16 left-0 sm:left-10',
    'bottom-24 right-0 sm:right-6',
  ][index];
}

function cardGlow(index: number) {
  return ['bg-[#f2b09d]/55', 'bg-[#a8cbb3]/60', 'bg-[#f4d690]/55', 'bg-[#b7b4e8]/45'][index % 4];
}
