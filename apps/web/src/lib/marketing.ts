export const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://lifecoach.app';

export type HelpTopic = {
  slug: string;
  audience: string;
  intent: string;
  title: string;
  h1: string;
  description: string;
  opener: string;
  keyphrases: string[];
  useCases: string[];
  ctaPrompt: string;
  faqs: Array<{ question: string; answer: string }>;
};

export const helpTopics = [
  {
    slug: 'overwhelm',
    audience: 'Anyone whose day feels too loud',
    intent: 'i feel overwhelmed app, how to stop feeling overwhelmed',
    title: 'AI assistant for overwhelm | Lifecoach',
    h1: 'The AI assistant that prevents overwhelm.',
    description:
      'Lifecoach helps you slow the swirl, name the next tiny step, and turn daily admin into a calmer plan.',
    opener:
      'When everything is urgent, even opening the calendar can feel like too much. Lifecoach starts by lowering the pressure: what is actually on fire, what can wait, and what is the next kind step?',
    keyphrases: [
      'i feel overwhelmed app',
      'how to stop feeling overwhelmed',
      'AI assistant for overwhelm',
    ],
    useCases: [
      'You have a wall of unread messages and need someone to separate decisions from noise.',
      'You keep rewriting the same to-do list because every item feels equally important.',
      'You need a five-minute plan that respects low energy instead of pretending you are at 100%.',
      'You want a warm check-in that remembers what mattered yesterday.',
    ],
    ctaPrompt: 'Tell Lifecoach what feels loud right now.',
    faqs: [
      {
        question: 'Can an AI assistant really help when I feel overwhelmed?',
        answer:
          'It can help by reflecting the situation back, reducing the number of open loops, and turning vague pressure into one or two concrete next actions.',
      },
      {
        question: 'Is Lifecoach therapy?',
        answer:
          'No. Lifecoach is practical day-to-day support for planning, reflection, and admin. It is not a replacement for clinical care or crisis support.',
      },
      {
        question: 'What makes this different from a to-do list?',
        answer:
          'A to-do list stores tasks. Lifecoach helps decide what matters now, remembers context, and can work with your calendar, email, and tasks when connected.',
      },
    ],
  },
  {
    slug: 'adhd',
    audience: 'ADHD adults',
    intent: 'AI assistant for ADHD, ADHD task initiation app, executive function support',
    title: 'AI assistant for ADHD task initiation | Lifecoach',
    h1: 'Executive function support for ADHD adults.',
    description:
      'An AI assistant for ADHD task initiation, inbox triage, calendar planning, and the messy middle between knowing and doing.',
    opener:
      'You know what the task is. You may even know why it matters. The hard part is crossing the invisible bridge from intention into motion without shame spiralling or spending an hour setting up the perfect system.',
    keyphrases: ['AI assistant for ADHD', 'ADHD task initiation app', 'executive function support'],
    useCases: [
      'You have been staring at your inbox for an hour and need the first reply drafted.',
      'You need the task made smaller without being spoken to like a child.',
      'You want help choosing between five competing priorities before the day disappears.',
      'You need a body-double style plan for the next 25 minutes.',
    ],
    ctaPrompt: 'Start with the task you cannot seem to begin.',
    faqs: [
      {
        question: 'How does Lifecoach support ADHD executive function?',
        answer:
          'It helps externalise decisions, break work into low-friction starts, and keep context visible across goals, tasks, calendar events, and conversations.',
      },
      {
        question: 'Does Lifecoach diagnose ADHD?',
        answer:
          'No. It is not a diagnostic or medical tool. It is designed as practical support for people who experience ADHD-like executive function bottlenecks.',
      },
      {
        question: 'Can it connect to my work tools?',
        answer:
          'Yes. Google Workspace support lets Lifecoach help with Gmail, Calendar, and Tasks after you explicitly connect your account.',
      },
    ],
  },
  {
    slug: 'depression',
    audience: 'People in low-motivation phases',
    intent: 'AI for depression daily tasks, depression and executive function app',
    title: 'AI support for depression daily tasks | Lifecoach',
    h1: 'Gentle daily-task support when motivation is low.',
    description:
      'Lifecoach helps with depression-related executive function friction: tiny next steps, compassionate planning, and low-energy admin triage.',
    opener:
      'Some days the problem is not ambition. It is that the laundry, the email, the appointment, and the meal all feel like they require energy you do not have. Lifecoach keeps the plan small and humane.',
    keyphrases: [
      'AI for depression daily tasks',
      'depression and executive function app',
      'low motivation task support',
    ],
    useCases: [
      'You need to choose the smallest useful action after a hard morning.',
      'You want help preparing one message you have been avoiding.',
      'You need a plan that includes food, rest, and one necessary admin step.',
      'You want to notice a win without forcing toxic positivity.',
    ],
    ctaPrompt: 'Tell Lifecoach what feels heavy today.',
    faqs: [
      {
        question: 'Is Lifecoach a depression treatment?',
        answer:
          'No. Lifecoach is not medical care. It can provide supportive planning and reflection, and you should contact a qualified professional or emergency service for clinical or crisis needs.',
      },
      {
        question: 'What if I only have energy for one thing?',
        answer:
          'That is exactly the use case: Lifecoach can help pick a minimum viable action and make it easier to start.',
      },
      {
        question: 'Will it pressure me to optimise my life?',
        answer:
          'The tone is intentionally warm and realistic. The product is built for grounded next steps, not hustle-culture productivity.',
      },
    ],
  },
  {
    slug: 'anxiety',
    audience: 'Anxious users',
    intent: 'AI to calm anxiety, rumination tracking app',
    title: 'AI assistant for anxiety and rumination | Lifecoach',
    h1: 'A calmer place to untangle anxious loops.',
    description:
      'Use Lifecoach to externalise anxious thoughts, turn rumination into a plan, and decide what needs action versus reassurance.',
    opener:
      'Anxiety can make the same thought return with a different costume every ten minutes. Lifecoach helps put the loop somewhere visible, then asks: is there a next action, a boundary, or a way to let this wait?',
    keyphrases: ['AI to calm anxiety', 'rumination tracking app', 'anxiety planning assistant'],
    useCases: [
      'You keep replaying a conversation and need to decide whether any action is needed.',
      'You want a short grounding plan before opening email.',
      'You need to prepare for a difficult call without rehearsing for hours.',
      'You want to track recurring worry themes over time.',
    ],
    ctaPrompt: 'Share the loop you want to put down for a moment.',
    faqs: [
      {
        question: 'Can Lifecoach calm anxiety?',
        answer:
          'It can offer grounding prompts, planning support, and a place to organise anxious thoughts, but it is not a clinical anxiety treatment.',
      },
      {
        question: 'Does it remember recurring patterns?',
        answer:
          'Yes. Lifecoach is designed to carry forward useful context so future conversations can reference recurring blockers and preferences.',
      },
      {
        question: 'Can I use it before work tasks?',
        answer:
          'Yes. It is especially useful for turning pre-task rumination into a bounded start and a realistic next step.',
      },
    ],
  },
  {
    slug: 'wellness',
    audience: 'Generalist health support',
    intent: 'AI wellness coach, sleep movement nutrition support',
    title: 'AI wellness coach for sleep, movement, and nutrition | Lifecoach',
    h1: 'Wellness coaching that fits your actual day.',
    description:
      'A practical AI wellness coach for sleep, movement, meals, reflection, and small behaviour changes that survive real life.',
    opener:
      'Wellness advice is easy to collect and hard to live. Lifecoach focuses on the next realistic adjustment: a walk between meetings, a simpler dinner, a bedtime cue, or a recovery day without guilt.',
    keyphrases: [
      'AI wellness coach',
      'sleep movement nutrition support',
      'daily wellness planning',
    ],
    useCases: [
      'You want a morning plan that accounts for sleep, weather, meetings, and energy.',
      'You need a movement option that fits a packed calendar.',
      'You want to reflect on what helped without starting a complicated tracker.',
      'You need a gentle reset after a disrupted week.',
    ],
    ctaPrompt: 'Ask Lifecoach for one wellness adjustment for today.',
    faqs: [
      {
        question: 'Does Lifecoach create medical advice?',
        answer:
          'No. It supports general wellness planning and reflection, and it should not replace medical, nutrition, or mental health professionals.',
      },
      {
        question: 'Can it use local context?',
        answer:
          'Yes. With browser location permission, Lifecoach can use local context such as weather to make suggestions more realistic.',
      },
      {
        question: 'What habits does it support?',
        answer:
          'Common patterns include sleep routines, movement, meals, gratitude, journaling, and goal check-ins.',
      },
    ],
  },
  {
    slug: 'career',
    audience: 'Career coaching audience',
    intent: 'AI career coach, career direction app, salary negotiation AI',
    title: 'AI career coach for direction and decisions | Lifecoach',
    h1: 'Career coaching for the decisions you keep postponing.',
    description:
      'Lifecoach helps with career direction, salary negotiation prep, job-search admin, and turning vague dissatisfaction into next steps.',
    opener:
      'Career stress often arrives as a fog: update the CV, message that person, ask for more money, decide whether to leave. Lifecoach helps turn the fog into a few honest options and one doable move.',
    keyphrases: ['AI career coach', 'career direction app', 'salary negotiation AI'],
    useCases: [
      'You need to turn a vague “I need a new job” feeling into a weekly plan.',
      'You want to prepare talking points for a salary conversation.',
      'You need help writing a follow-up without overthinking the tone.',
      'You want to compare opportunities against your actual values and constraints.',
    ],
    ctaPrompt: 'Tell Lifecoach the career decision you are circling.',
    faqs: [
      {
        question: 'Can Lifecoach help with salary negotiation?',
        answer:
          'It can help clarify goals, prepare scripts, and rehearse likely objections. It does not guarantee compensation outcomes.',
      },
      {
        question: 'Is this only for job searching?',
        answer:
          'No. It also supports career direction, workplace boundaries, promotion planning, and difficult conversations.',
      },
      {
        question: 'Can it help with follow-up emails?',
        answer: 'Yes. Workspace support can help draft and triage email once connected.',
      },
    ],
  },
  {
    slug: 'menopause',
    audience: 'Peri/menopause support',
    intent: 'menopause symptom coach, perimenopause AI support',
    title: 'Perimenopause and menopause AI support | Lifecoach',
    h1: 'A practical coach for perimenopause brain fog and life admin.',
    description:
      'Lifecoach supports perimenopause and menopause routines, symptom-aware planning, and daily admin when brain fog is high.',
    opener:
      'When sleep changes, mood shifts, hot flushes, and brain fog collide with normal responsibilities, “just be organised” is not enough. Lifecoach helps adjust the day around the body you have today.',
    keyphrases: [
      'menopause symptom coach',
      'perimenopause AI support',
      'menopause brain fog planning',
    ],
    useCases: [
      'You need to plan work around poor sleep and lower capacity.',
      'You want to capture symptom patterns and questions for a clinician.',
      'You need reminders and admin triage when brain fog is heavy.',
      'You want a compassionate evening reset after a difficult day.',
    ],
    ctaPrompt: 'Ask Lifecoach to plan around your capacity today.',
    faqs: [
      {
        question: 'Does Lifecoach provide menopause medical advice?',
        answer:
          'No. It can help track patterns, prepare questions, and plan daily routines, but clinical decisions belong with qualified healthcare professionals.',
      },
      {
        question: 'Can it help with brain fog?',
        answer:
          'It can reduce cognitive load by externalising plans, reminders, and decisions into a conversation that keeps context visible.',
      },
      {
        question: 'Can I use it for work planning?',
        answer:
          'Yes. It can help create lower-friction plans around meetings, energy, and unavoidable admin.',
      },
    ],
  },
  {
    slug: 'personal-assistant',
    audience: 'Calendar, email, and task triage',
    intent: 'AI personal assistant ADHD, inbox triage AI, task management for ADHD adults',
    title: 'AI personal assistant for inbox and task triage | Lifecoach',
    h1: 'An AI personal assistant for the admin pile-up.',
    description:
      'Connect Gmail, Calendar, and Tasks so Lifecoach can help triage inboxes, plan calendars, and turn loose intent into next actions.',
    opener:
      'The problem is rarely one email. It is the stack: a calendar conflict, three messages needing decisions, a task you forgot, and the dread of opening any of it. Lifecoach coordinates the pile.',
    keyphrases: [
      'AI personal assistant ADHD',
      'inbox triage AI',
      'task management for ADHD adults',
    ],
    useCases: [
      'You need email split into reply now, schedule, archive, and ignore.',
      'You want calendar-aware task planning instead of an impossible list.',
      'You need one message drafted in your voice before you lose momentum.',
      'You want loose intentions converted into Google Tasks.',
    ],
    ctaPrompt: 'Bring Lifecoach one piece of admin you are avoiding.',
    faqs: [
      {
        question: 'Which workspace tools can Lifecoach use?',
        answer:
          'The app includes Google Workspace integration for Gmail, Calendar, and Tasks after explicit OAuth connection.',
      },
      {
        question: 'Do workspace tokens go to the model?',
        answer: 'No. Workspace tokens stay in the app layer and are not sent to the model.',
      },
      {
        question: 'Can it replace a human assistant?',
        answer:
          'No. It is best understood as practical triage and planning support for personal admin, not a full delegated assistant.',
      },
    ],
  },
] satisfies HelpTopic[];

export const helpTopicSlugs = helpTopics.map((topic) => topic.slug);

export function getHelpTopic(slug: string) {
  return helpTopics.find((topic) => topic.slug === slug);
}

export function absoluteUrl(path: string) {
  return new URL(path, siteUrl).toString();
}
