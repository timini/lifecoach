import type { ReactNode } from 'react';
import { featurePages } from '../lib/marketing/feature-pages';

const signalCards = [
  {
    title: 'Weather, calendar, goals, and mood in one gentle frame',
    body: 'tranquil.coach reads the shape of the day before it suggests the next move — so advice feels situated, not generic.',
  },
  {
    title: 'Memory that becomes care, not creepiness',
    body: 'Your patterns, preferences, blockers, and promises compound into a calmer relationship with your own life.',
  },
  {
    title: 'Workspace help when admin gets emotional',
    body: 'Connect Google Workspace for inbox triage, calendar repair, task pruning, and drafts that turn dread into action.',
  },
];

const rituals = [
  {
    time: '08:10',
    name: 'Morning clearing',
    detail: 'one priority, weather-aware errands, energy budget',
  },
  {
    time: '12:35',
    name: 'Friction sweep',
    detail: 'stuck email, tiny calendar move, food that counts',
  },
  {
    time: '21:20',
    name: 'Soft landing',
    detail: 'wins captured, loose loops parked, tomorrow made lighter',
  },
];

const proofPoints = [
  { value: '0', label: 'setup steps before your first chat' },
  { value: '3', label: 'daily rituals that keep momentum humane' },
  { value: '1', label: 'place for goals, inbox, tasks, reflection, and context' },
];

const principles = [
  'Short, warm replies — no productivity cosplay or corporate life-hack essays.',
  'Browser-only location sharing; no IP geolocation fallbacks.',
  'Workspace OAuth tokens stay in the app layer and never go to the model.',
  'You stay in control of what gets sent, scheduled, saved, or ignored.',
];

const constellations = [
  'ADHD',
  'burnout',
  'anxiety',
  'new-parent fog',
  'peri/menopause',
  'low motivation',
];

export default function LandingPage() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#f7f1e8] text-[#20342d]">
      <section className="relative px-5 py-6 sm:px-8 lg:px-12">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_12%_18%,rgba(116,159,138,0.34),transparent_30%),radial-gradient(circle_at_82%_10%,rgba(236,167,127,0.28),transparent_32%),linear-gradient(135deg,#f7f1e8_0%,#eef4e9_48%,#f9e3d8_100%)]" />
        <div className="absolute left-1/2 top-24 -z-10 h-[520px] w-[520px] -translate-x-1/2 rounded-full border border-white/50 bg-white/20 blur-3xl" />

        <MarketingNav />

        <div className="mx-auto grid max-w-7xl gap-12 pb-16 pt-16 lg:grid-cols-[1.02fr_0.98fr] lg:items-center lg:pb-24 lg:pt-24">
          <div>
            <p className="mb-5 inline-flex rounded-full border border-[#749f8a]/30 bg-white/45 px-4 py-2 text-sm font-semibold text-[#385f50] shadow-sm backdrop-blur">
              AI coaching for a nervous system with a calendar
            </p>
            <h1 className="max-w-4xl text-balance font-serif text-5xl font-semibold leading-[0.98] tracking-tight text-[#182d26] sm:text-6xl lg:text-8xl">
              Make the day feel possible again.
            </h1>
            <p className="mt-7 max-w-2xl text-pretty text-lg leading-8 text-[#58665f] sm:text-xl">
              tranquil.coach is a beautiful, context-aware companion for the fuzzy middle between
              productivity apps and therapy: overwhelm, ADHD task initiation, low motivation,
              anxious loops, career decisions, wellness routines, peri/menopause fog, and the admin
              pile that keeps following you around.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a
                href="/chat"
                className="inline-flex items-center justify-center rounded-full bg-[#20342d] px-7 py-4 text-base font-semibold text-[#fffaf1] shadow-xl shadow-[#20342d]/15 transition hover:-translate-y-0.5 hover:bg-[#5e8b76]"
              >
                Open a calm thread
              </a>
              <a
                href="#rituals"
                className="inline-flex items-center justify-center rounded-full border border-white/70 bg-white/55 px-7 py-4 text-base font-semibold text-[#20342d] shadow-sm backdrop-blur transition hover:-translate-y-0.5 hover:border-[#749f8a]"
              >
                Tour the redesign
              </a>
            </div>
            <div className="mt-8 flex flex-wrap gap-2">
              {constellations.map((item) => (
                <span
                  key={item}
                  className="rounded-full border border-white/70 bg-white/45 px-3 py-1.5 text-sm font-semibold text-[#53625b] backdrop-blur"
                >
                  {item}
                </span>
              ))}
            </div>
            <dl className="mt-10 grid max-w-2xl grid-cols-3 gap-3">
              {proofPoints.map((point) => (
                <div
                  key={point.label}
                  className="rounded-[1.75rem] border border-white/70 bg-white/50 p-4 shadow-sm backdrop-blur"
                >
                  <dt className="font-serif text-3xl font-semibold text-[#20342d]">
                    {point.value}
                  </dt>
                  <dd className="mt-1 text-xs leading-5 text-[#68756e]">{point.label}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="relative">
            <div className="absolute -right-6 top-10 h-28 w-28 rounded-full bg-[#efb58c]/40 blur-2xl" />
            <div className="rounded-[2.4rem] border border-white/70 bg-white/50 p-3 shadow-2xl shadow-[#20342d]/15 backdrop-blur-xl">
              <div className="overflow-hidden rounded-[2rem] border border-white/80 bg-[#fffaf1]">
                <div className="flex items-center justify-between bg-[#20342d] px-5 py-4 text-[#fffaf1]">
                  <div>
                    <p className="font-serif text-2xl font-semibold">tranquil.coach</p>
                    <p className="text-sm text-[#dbe7df]">soft command center · 8:14 AM</p>
                  </div>
                  <span className="rounded-full bg-[#eebf9d]/20 px-3 py-1 text-xs font-semibold text-[#ffe8d9]">
                    calm mode
                  </span>
                </div>
                <div className="grid gap-4 p-5 lg:grid-cols-[0.92fr_1.08fr]">
                  <div className="space-y-4">
                    <ChatBubble align="left">
                      Good morning. Rain after lunch, three meetings, and one task you keep
                      avoiding. Want me to protect the best thinking hour first?
                    </ChatBubble>
                    <ChatBubble align="right">
                      Yes. Also my inbox is making me want to disappear.
                    </ChatBubble>
                    <ChatBubble align="left">
                      Then we will make it small: draft Mara first, archive the receipts, and park
                      the rest in a 14-minute sweep after lunch.
                    </ChatBubble>
                  </div>
                  <div className="rounded-[1.5rem] bg-[#eef4e9] p-4">
                    <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#5e8b76]">
                      Today’s map
                    </p>
                    <div className="mt-4 space-y-3">
                      {rituals.map((ritual) => (
                        <div key={ritual.name} className="rounded-2xl bg-white/75 p-4 shadow-sm">
                          <div className="flex items-center justify-between gap-3">
                            <p className="font-serif text-xl font-semibold">{ritual.name}</p>
                            <span className="rounded-full bg-[#20342d] px-3 py-1 text-xs font-bold text-[#fffaf1]">
                              {ritual.time}
                            </span>
                          </div>
                          <p className="mt-2 text-sm leading-6 text-[#68756e]">{ritual.detail}</p>
                        </div>
                      ))}
                    </div>
                    <div className="mt-4 grid grid-cols-3 gap-2">
                      {['Plan', 'Triage', 'Reflect'].map((action) => (
                        <button
                          key={action}
                          type="button"
                          className="rounded-2xl bg-[#f4ddcf] px-3 py-3 text-sm font-bold text-[#57392d]"
                        >
                          {action}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="rituals" className="px-5 py-16 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-7xl">
          <SectionKicker>Product thesis</SectionKicker>
          <div className="grid gap-8 lg:grid-cols-[0.82fr_1.18fr] lg:items-end">
            <h2 className="font-serif text-4xl font-semibold leading-tight sm:text-6xl">
              Not another dashboard. A living room for your next right step.
            </h2>
            <p className="text-lg leading-8 text-[#637168]">
              The redesign moves tranquil.coach away from app-like productivity pressure and into a
              sensory, spacious coaching environment: warm surfaces, botanical greens, soft coral
              highlights, and cards that feel like a hand on the shoulder rather than a KPI board.
            </p>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {signalCards.map((card) => (
              <article
                key={card.title}
                className="rounded-[2rem] border border-white/70 bg-white/60 p-7 shadow-sm backdrop-blur transition hover:-translate-y-1 hover:shadow-xl hover:shadow-[#20342d]/10"
              >
                <div className="mb-8 h-2 w-20 rounded-full bg-gradient-to-r from-[#749f8a] to-[#efb58c]" />
                <h3 className="font-serif text-2xl font-semibold leading-tight">{card.title}</h3>
                <p className="mt-4 text-sm leading-7 text-[#68756e]">{card.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="use-cases" className="px-5 py-16 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-7xl rounded-[2.5rem] bg-[#20342d] p-6 text-[#fffaf1] shadow-2xl shadow-[#20342d]/15 sm:p-10">
          <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[#eebf9d]">
                Gentle operating system
              </p>
              <h2 className="mt-4 font-serif text-4xl font-semibold leading-tight sm:text-5xl">
                A place to bring the pile before the pile becomes your personality.
              </h2>
              <p className="mt-5 text-[#d8e5dd]">
                tranquil.coach is built for the ordinary and the tender: half-written replies,
                avoidance, decisions that got too big, body symptoms, messy ambition, and nights
                when your brain opens every tab at once.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {featurePages.map((page) => (
                <a
                  key={page.topic}
                  href={`/how-it-helps/${page.topic}`}
                  className="group rounded-[1.75rem] border border-white/10 bg-white/[0.07] p-5 transition hover:-translate-y-0.5 hover:bg-white/[0.12]"
                >
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#eebf9d]">
                    {page.audience}
                  </p>
                  <h3 className="mt-3 font-serif text-2xl font-semibold leading-tight text-white">
                    {page.title}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-[#d8e5dd]">{page.description}</p>
                  <span className="mt-5 inline-flex text-sm font-bold text-[#eebf9d]">
                    Visit page →
                  </span>
                </a>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="privacy" className="px-5 py-16 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-7xl rounded-[2.5rem] border border-white/70 bg-white/55 p-8 shadow-sm backdrop-blur sm:p-10 lg:p-12">
          <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
            <div>
              <SectionKicker>Trust by design</SectionKicker>
              <h2 className="mt-3 font-serif text-4xl font-semibold leading-tight">
                Personal enough to be useful. Boundaried enough to feel safe.
              </h2>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2">
              {principles.map((principle) => (
                <li
                  key={principle}
                  className="rounded-3xl border border-white/80 bg-[#fffaf1]/80 p-5 text-sm font-medium leading-7 text-[#637168]"
                >
                  <span className="mr-2 text-[#5e8b76]">✦</span>
                  {principle}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="px-5 pb-20 pt-10 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-4xl text-center">
          <p className="mx-auto mb-5 w-fit rounded-full border border-[#749f8a]/25 bg-white/50 px-4 py-2 text-sm font-semibold text-[#385f50]">
            start exactly where you are
          </p>
          <h2 className="font-serif text-4xl font-semibold leading-tight sm:text-6xl">
            Bring one honest sentence. We’ll make it smaller together.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-[#637168]">
            Tell tranquil.coach what is on your mind today. It will help you find the next grounded,
            doable move without asking you to become a different person first.
          </p>
          <a
            href="/chat"
            className="mt-8 inline-flex items-center justify-center rounded-full bg-[#20342d] px-8 py-4 text-base font-semibold text-[#fffaf1] shadow-lg shadow-[#20342d]/10 transition hover:-translate-y-0.5 hover:bg-[#5e8b76]"
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
    <nav className="mx-auto flex max-w-7xl items-center justify-between rounded-full border border-white/70 bg-white/55 px-4 py-3 shadow-sm backdrop-blur-xl">
      <a href="/" className="font-serif text-2xl font-semibold tracking-tight text-[#20342d]">
        tranquil.coach
      </a>
      <div className="hidden items-center gap-6 text-sm font-medium text-[#637168] md:flex">
        <a href="#rituals" className="transition hover:text-[#20342d]">
          Product
        </a>
        <a href="#privacy" className="transition hover:text-[#20342d]">
          Privacy
        </a>
        <a href="#use-cases" className="transition hover:text-[#20342d]">
          Use cases
        </a>
        <a href="/blog" className="transition hover:text-[#20342d]">
          Blog
        </a>
      </div>
      <a
        href="/chat"
        className="rounded-full bg-[#20342d] px-5 py-2.5 text-sm font-semibold text-[#fffaf1] shadow-sm transition hover:-translate-y-0.5 hover:bg-[#5e8b76]"
      >
        Start coaching
      </a>
    </nav>
  );
}

function SectionKicker({ children }: { children: ReactNode }) {
  return (
    <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[#5e8b76]">{children}</p>
  );
}

function ChatBubble({ children, align }: { children: ReactNode; align: 'left' | 'right' }) {
  return (
    <div className={align === 'right' ? 'flex justify-end' : 'flex justify-start'}>
      <p
        className={
          align === 'right'
            ? 'max-w-[86%] rounded-[1.35rem] bg-[#749f8a] px-4 py-3 text-sm leading-6 text-white shadow-sm'
            : 'max-w-[88%] rounded-[1.35rem] bg-[#f0e8dc] px-4 py-3 text-sm leading-6 text-[#20342d] shadow-sm'
        }
      >
        {children}
      </p>
    </div>
  );
}
