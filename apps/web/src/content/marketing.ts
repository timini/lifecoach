export type FeatureTopic = {
  slug: string;
  audience: string;
  eyebrow: string;
  title: string;
  metaTitle: string;
  metaDescription: string;
  opener: string;
  keyphrases: string[];
  useCases: string[];
  ctaPrompt: string;
  faqs: Array<{ question: string; answer: string }>;
};

export type BlogPost = {
  slug: string;
  type: 'Evidence-backed' | 'Personal story';
  title: string;
  description: string;
  publishedAt: string;
  targetSubreddit: string;
  tags: string[];
  sections: Array<{ heading: string; body: string[] }>;
  citations?: Array<{ label: string; href: string }>;
};

export const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://lifecoach.timini.dev';

export const featureTopics = [
  {
    slug: 'overwhelm',
    audience: 'Everyone who is carrying too much',
    eyebrow: 'Prevents overwhelm',
    title: 'The AI assistant that prevents overwhelm before the day collapses.',
    metaTitle: 'AI assistant for overwhelm | Lifecoach',
    metaDescription:
      'Lifecoach helps you name the bottleneck, shrink the next step, and move through daily admin without spiralling.',
    opener:
      'When everything feels urgent, even opening the laptop can feel like stepping into a weather system. Lifecoach starts by lowering the noise: one honest check-in, one next action, and no productivity theatre.',
    keyphrases: [
      'i feel overwhelmed app',
      'how to stop feeling overwhelmed',
      'AI assistant overwhelm',
    ],
    useCases: [
      'Turn a messy “I cannot deal with today” note into a three-step plan.',
      'Separate true deadlines from guilt, noise, and stale tasks.',
      'Pick the smallest useful action when your brain wants to avoid everything.',
      'Reset after a disrupted morning without declaring the whole day ruined.',
    ],
    ctaPrompt: 'I feel overwhelmed and need help choosing the next tiny step.',
    faqs: [
      {
        question: 'Is Lifecoach therapy?',
        answer:
          'No. Lifecoach is practical daily support for planning, reflection, and admin. It is not a crisis service or a replacement for a clinician.',
      },
      {
        question: 'How does it prevent overwhelm?',
        answer:
          'It keeps the conversation scoped: what is happening, what matters today, what can wait, and what the next doable action is.',
      },
    ],
  },
  {
    slug: 'adhd',
    audience: 'ADHD adults',
    eyebrow: 'Executive function support',
    title: 'AI task initiation support for ADHD adults who know what to do but cannot start.',
    metaTitle: 'AI assistant for ADHD task initiation | Lifecoach',
    metaDescription:
      'Get warm, concrete executive-function support for ADHD task initiation, inbox triage, planning, and follow-through.',
    opener:
      'ADHD productivity advice often assumes the missing piece is discipline. Usually it is initiation, sequencing, memory, or emotional friction. Lifecoach helps externalise the plan so you do not have to hold the whole thing in your head.',
    keyphrases: ['AI assistant for ADHD', 'ADHD task initiation app', 'executive function support'],
    useCases: [
      'Break the task you have avoided for three weeks into the first two minutes.',
      'Body-double a boring admin block with short check-ins and permission to do it imperfectly.',
      'Triage a chaotic inbox into reply, schedule, delegate, and ignore piles.',
      'Create a morning plan that accounts for time blindness and context switching.',
    ],
    ctaPrompt: 'Help me start the thing I keep avoiding, ADHD-friendly please.',
    faqs: [
      {
        question: 'Can Lifecoach diagnose ADHD?',
        answer:
          'No. It cannot diagnose or treat ADHD. It can provide practical planning and executive-function scaffolding for daily tasks.',
      },
      {
        question: 'Can it work with my calendar and email?',
        answer:
          'Yes, if you connect Google Workspace, Lifecoach can help reason over Gmail, Calendar, and Tasks from inside the app.',
      },
    ],
  },
  {
    slug: 'depression',
    audience: 'People in low-motivation phases',
    eyebrow: 'Low-energy momentum',
    title: 'Daily task support for depression days when “just do it” is useless.',
    metaTitle: 'AI for depression daily tasks | Lifecoach',
    metaDescription:
      'Lifecoach helps shrink daily tasks during low motivation, depression, and executive dysfunction without shame or hustle language.',
    opener:
      'On low days, the problem is not that you forgot the motivational quote. The problem is that showering, replying, eating, or paying a bill can feel impossibly far away. Lifecoach keeps the bar humane.',
    keyphrases: [
      'AI for depression daily tasks',
      'depression executive function app',
      'low motivation task help',
    ],
    useCases: [
      'Choose one maintenance task that protects future-you without demanding a whole reset.',
      'Write a low-energy text or email when your brain is stuck in avoidance.',
      'Make a minimum viable day plan around food, medication, light, and one admin item.',
      'Reflect on what helped without turning recovery into another performance metric.',
    ],
    ctaPrompt: 'I am low and need a minimum viable plan for today.',
    faqs: [
      {
        question: 'What if I am in crisis?',
        answer:
          'If you might hurt yourself or someone else, contact local emergency services or a crisis line now. Lifecoach is not built for emergency support.',
      },
      {
        question: 'Will it pressure me to be productive?',
        answer:
          'The copy and flows are designed around humane next steps, not hustle. Sometimes the useful action is food, rest, or asking for help.',
      },
    ],
  },
  {
    slug: 'anxiety',
    audience: 'Anxious users and rumination loops',
    eyebrow: 'From rumination to next action',
    title: 'An AI companion for anxiety spirals, rumination, and practical calming.',
    metaTitle: 'AI to calm anxiety and rumination | Lifecoach',
    metaDescription:
      'Use Lifecoach to externalise anxious loops, sort facts from fears, and choose a grounded next step.',
    opener:
      'Anxiety can make the same thought feel like a task, a warning, and a verdict all at once. Lifecoach helps get it out of your head and onto rails: what do we know, what can wait, and what would make the next hour easier?',
    keyphrases: ['AI to calm anxiety', 'rumination tracking app', 'anxiety next step app'],
    useCases: [
      'Untangle a worry loop into facts, assumptions, and one controllable action.',
      'Prepare for a difficult conversation without rehearsing it all day.',
      'Create a decompression plan after a stressful meeting.',
      'Capture recurring triggers so patterns are easier to notice later.',
    ],
    ctaPrompt: 'Help me sort this anxious loop into facts and next steps.',
    faqs: [
      {
        question: 'Does Lifecoach provide medical advice?',
        answer:
          'No. It offers practical coaching-style support and reflection, not medical advice or treatment.',
      },
      {
        question: 'Can it help with rumination?',
        answer:
          'It can help you externalise repetitive thoughts, identify what is actionable, and choose a small grounding action.',
      },
    ],
  },
  {
    slug: 'wellness',
    audience: 'General health and wellness users',
    eyebrow: 'Whole-day wellness',
    title: 'An AI wellness coach for sleep, movement, food, reflection, and follow-through.',
    metaTitle: 'AI wellness coach for daily routines | Lifecoach',
    metaDescription:
      'Plan realistic wellness routines around your real day, including energy, calendar shape, weather, goals, and reflection.',
    opener:
      'Wellness plans fail when they ignore the day you actually have. Lifecoach helps translate sleep, movement, nutrition, and reflection goals into something that fits your calendar instead of competing with it.',
    keyphrases: [
      'AI wellness coach',
      'sleep movement nutrition support',
      'daily wellness assistant',
    ],
    useCases: [
      'Plan movement around weather and meetings instead of vague intentions.',
      'Choose a realistic dinner or grocery step when energy is low.',
      'Reflect on sleep and mood patterns without manually building a spreadsheet.',
      'Protect one recovery habit during an overloaded week.',
    ],
    ctaPrompt: 'Help me build a realistic wellness plan for today.',
    faqs: [
      {
        question: 'Is Lifecoach a fitness tracker?',
        answer:
          'No. It is a conversational coach for planning and reflection, designed to complement trackers and calendars.',
      },
      {
        question: 'Does it give nutrition advice?',
        answer:
          'It can help with general planning and habit support, but it does not replace qualified medical or nutrition advice.',
      },
    ],
  },
  {
    slug: 'career',
    audience: 'Career coaching audience',
    eyebrow: 'Career direction without panic',
    title: 'An AI career coach for direction, decisions, negotiation, and next steps.',
    metaTitle: 'AI career coach for direction and negotiation | Lifecoach',
    metaDescription:
      'Use Lifecoach to clarify career direction, prepare conversations, plan job-search admin, and practise salary negotiation.',
    opener:
      'Career questions rarely arrive neatly. They show up as Sunday dread, salary anxiety, a vague urge to leave, or a CV tab you keep closing. Lifecoach turns the fog into a conversation and the conversation into next steps.',
    keyphrases: ['AI career coach', 'career direction app', 'salary negotiation AI'],
    useCases: [
      'Map the difference between burnout, boredom, and a real career mismatch.',
      'Draft a manager conversation or salary-negotiation script in your own voice.',
      'Turn job-search anxiety into a weekly pipeline with manageable admin blocks.',
      'Prepare for interviews by connecting examples to the role you want.',
    ],
    ctaPrompt: 'Help me think through my career next step without spiralling.',
    faqs: [
      {
        question: 'Can Lifecoach write job applications?',
        answer:
          'It can help draft, structure, and refine materials, but the strongest output comes from your specific experience and judgement.',
      },
      {
        question: 'Can it help with salary negotiation?',
        answer:
          'Yes, it can help you prepare talking points, boundaries, and rehearsal prompts for negotiation conversations.',
      },
    ],
  },
  {
    slug: 'menopause',
    audience: 'Peri/menopause users',
    eyebrow: 'Fog-aware support',
    title: 'An AI support coach for perimenopause, menopause fog, and daily admin.',
    metaTitle: 'Menopause symptom coach for daily planning | Lifecoach',
    metaDescription:
      'Lifecoach helps track patterns, plan around fatigue or fog, and keep daily admin moving during peri/menopause.',
    opener:
      'Brain fog, sleep disruption, mood shifts, and invisible labour can make ordinary admin feel twice as heavy. Lifecoach gives you a place to notice patterns and build a day that does not pretend your energy is constant.',
    keyphrases: [
      'menopause symptom coach',
      'perimenopause AI support',
      'menopause brain fog planning',
    ],
    useCases: [
      'Track recurring sleep, mood, focus, and symptom notes in plain language.',
      'Plan a lighter admin day after disrupted sleep or a heavy symptom morning.',
      'Prepare a concise note for a healthcare appointment or workplace conversation.',
      'Protect rest, movement, and obligations without holding everything in memory.',
    ],
    ctaPrompt: 'Help me plan around brain fog and low energy today.',
    faqs: [
      {
        question: 'Does Lifecoach provide menopause medical advice?',
        answer:
          'No. It supports planning and reflection. Medical decisions should be made with a qualified clinician.',
      },
      {
        question: 'Can it help me notice patterns?',
        answer:
          'Yes, conversations can capture recurring context and help you reflect on patterns over time.',
      },
    ],
  },
  {
    slug: 'personal-assistant',
    audience: 'Calendar, email, and task triage users',
    eyebrow: 'Daily admin triage',
    title: 'An AI personal assistant for inbox, calendar, and task overwhelm.',
    metaTitle: 'AI personal assistant for ADHD inbox triage | Lifecoach',
    metaDescription:
      'Connect Google Workspace to triage Gmail, Calendar, and Tasks with a calm AI assistant built for executive dysfunction.',
    opener:
      'The inbox is not just messages. It is decisions, guilt, hidden work, and context switching. Lifecoach helps turn daily admin into a short list of next actions instead of another place to drown.',
    keyphrases: [
      'AI personal assistant ADHD',
      'inbox triage AI',
      'task management for ADHD adults',
    ],
    useCases: [
      'Find the emails that actually need a decision today.',
      'Draft a reply when you know the intent but cannot find the words.',
      'Move a loose promise from chat or email into a calendar or task plan.',
      'Protect focus blocks by sequencing admin around meetings and energy.',
    ],
    ctaPrompt: 'Help me triage my inbox and calendar into next actions.',
    faqs: [
      {
        question: 'Do I have to connect Google Workspace?',
        answer:
          'No. You can use Lifecoach conversationally. Workspace connection is optional for email, calendar, and task help.',
      },
      {
        question: 'Are Workspace tokens sent to the model?',
        answer: 'No. Workspace OAuth tokens stay in the app layer and are not sent to the model.',
      },
    ],
  },
] satisfies FeatureTopic[];

export const blogPosts = [
  {
    slug: 'what-ai-coaching-can-and-cannot-do',
    type: 'Evidence-backed',
    title: 'What the science says about AI coaching for daily behaviour change',
    description:
      'A practical reading of chatbot coaching evidence: useful scaffolding, careful boundaries, and why tiny actions matter.',
    publishedAt: '2026-05-12',
    targetSubreddit: 'r/getdisciplined',
    tags: ['evidence', 'behaviour change', 'AI coaching'],
    sections: [
      {
        heading: 'The evidence is promising, not magical',
        body: [
          'Published trials around mental-health chatbots and digital coaching suggest that structured, conversational support can help some people with symptoms, adherence, and self-reflection. That does not make a chatbot a therapist, and it does not remove the need for clinical care when risk is high.',
          'The useful product lesson is narrower: people often need help at the point of action. A coach that asks a better question, shrinks the task, and remembers context can reduce friction in the moments where generic advice usually fails.',
        ],
      },
      {
        heading: 'Why Lifecoach focuses on tiny, contextual steps',
        body: [
          'Behaviour-change writing from BJ Fogg and James Clear converges on one practical idea: make the desired action easier to start and easier to repeat. For executive dysfunction, the “easy to start” part matters more than motivational intensity.',
          'That is why Lifecoach frames itself as overwhelm prevention. It is built to notice the calendar, the weather, the task, and the human energy level before suggesting the next move.',
        ],
      },
    ],
    citations: [
      {
        label: 'Fitzpatrick et al., JMIR Mental Health (Woebot trial)',
        href: 'https://mental.jmir.org/2017/2/e19/',
      },
      { label: 'Fogg Behavior Model', href: 'https://behaviormodel.org/' },
      { label: 'Atomic Habits', href: 'https://jamesclear.com/atomic-habits' },
    ],
  },
  {
    slug: 'staring-at-the-inbox-for-an-hour',
    type: 'Personal story',
    title: 'When you have been staring at your inbox for an hour',
    description:
      'A lived-experience walkthrough of turning inbox paralysis into three decisions and one humane next step.',
    publishedAt: '2026-05-12',
    targetSubreddit: 'r/ADHD',
    tags: ['ADHD', 'inbox triage', 'executive function'],
    sections: [
      {
        heading: 'The problem is not email; it is hidden decisions',
        body: [
          'Inbox paralysis feels irrational from the outside. From the inside, every unread message is a possible demand, disappointment, or context switch. You are not just reading email; you are absorbing a queue of decisions with no edges.',
          'A useful assistant should not say “just clear your inbox”. It should ask which messages affect today, which ones need a reply, and which ones can become a later task instead of a permanent open loop.',
        ],
      },
      {
        heading: 'A better first move',
        body: [
          'Open a conversation with the smallest true sentence: “I am avoiding my inbox and I need help finding the first reply.” From there, Lifecoach can help sort the pile, draft the awkward response, or pick one message that protects future-you.',
        ],
      },
    ],
  },
  {
    slug: 'minimum-viable-day-low-energy',
    type: 'Personal story',
    title: 'The minimum viable day for low energy, fog, or grief',
    description: 'A practical, non-hustle template for days when the normal plan is too heavy.',
    publishedAt: '2026-05-12',
    targetSubreddit: 'r/depression',
    tags: ['depression', 'burnout', 'daily planning'],
    sections: [
      {
        heading: 'Some days need a floor, not a ladder',
        body: [
          'On low-energy days, ambitious plans can become another source of shame. The minimum viable day is a floor: food, medication or care basics if relevant, one admin item that prevents a future problem, and one kind thing that makes the evening easier.',
          'The point is not to optimise the day. The point is to avoid abandoning yourself because the original plan stopped fitting reality.',
        ],
      },
      {
        heading: 'How Lifecoach can hold the plan',
        body: [
          'Instead of requiring a perfect task system, Lifecoach lets you start with the truth: “I am foggy and I need a tiny plan.” It can keep the list short, remind you what can wait, and help you return after interruptions without turning the day into a verdict.',
        ],
      },
    ],
  },
] satisfies BlogPost[];

export function getFeatureTopic(slug: string) {
  return featureTopics.find((topic) => topic.slug === slug);
}

export function getBlogPost(slug: string) {
  return blogPosts.find((post) => post.slug === slug);
}

export function absoluteUrl(path: string) {
  return new URL(path, siteUrl).toString();
}
