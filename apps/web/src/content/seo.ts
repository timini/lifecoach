export const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://lifecoach.timini.dev';

export type HelpTopic = {
  slug: string;
  audience: string;
  title: string;
  h1: string;
  description: string;
  opener: string;
  keyphrases: string[];
  useCases: string[];
  ctaPrompt: string;
  faqs: { question: string; answer: string }[];
};

export const helpTopics = [
  {
    slug: 'overwhelm',
    audience: 'Everyone who has more life admin than bandwidth',
    title: 'AI assistant that prevents overwhelm',
    h1: 'The AI assistant that prevents overwhelm.',
    description:
      'Lifecoach helps you stop spiralling, choose the next grounded step, and turn messy daily admin into a calm plan.',
    opener:
      'When everything feels urgent, even opening the inbox can feel like too much. Lifecoach helps you name the pile, lower the noise, and pick one survivable next action without pretending you just need more discipline.',
    keyphrases: [
      'i feel overwhelmed app',
      'how to stop feeling overwhelmed',
      'AI assistant for overwhelm',
    ],
    useCases: [
      'When you have ten half-started tasks and no idea which one matters first.',
      'When your messages, calendar, and errands blur into one loud mental tab.',
      'When you need a plan small enough to start in the next five minutes.',
      'When you want a warm reset after a day that got away from you.',
    ],
    ctaPrompt: 'I feel overwhelmed and need help choosing one next step.',
    faqs: [
      {
        question: 'Is Lifecoach a therapy replacement?',
        answer:
          'No. Lifecoach is a planning and daily-support assistant, not medical care or crisis support. It can help with practical next steps and reflection alongside your existing support system.',
      },
      {
        question: 'How does it reduce overwhelm?',
        answer:
          'It asks for the smallest useful amount of context, groups the noise into themes, and turns the day into a short plan instead of a giant productivity lecture.',
      },
    ],
  },
  {
    slug: 'adhd',
    audience: 'ADHD adults and people with executive-function bottlenecks',
    title: 'AI assistant for ADHD task initiation',
    h1: 'Executive-function support for ADHD days.',
    description:
      'An AI assistant for ADHD adults who need task initiation support, inbox triage, and kinder daily planning.',
    opener:
      'You know what matters, but the starting line keeps moving. Lifecoach is built for the ADHD gap between intention and action: body-doubling language, tiny next steps, fewer tabs in your head, and no shame spiral.',
    keyphrases: ['AI assistant for ADHD', 'ADHD task initiation app', 'executive function support'],
    useCases: [
      "When you've been staring at the same email for an hour and need the reply broken down.",
      'When a boring-but-important task needs a ten-minute launch plan.',
      'When your calendar says one thing and your energy says another.',
      'When you need to externalise the pile before it becomes avoidance.',
    ],
    ctaPrompt: 'Help me start a task I have been avoiding because of ADHD overwhelm.',
    faqs: [
      {
        question: 'Can Lifecoach help with task initiation?',
        answer:
          'Yes. It can turn a vague task into a first visible action, suggest a timer-sized plan, and help you recover when the first plan was too ambitious.',
      },
      {
        question: 'Does it require a complicated setup?',
        answer:
          'No. You can start with a chat, then optionally connect Google Workspace for email, calendar, and task context.',
      },
    ],
  },
  {
    slug: 'depression',
    audience: 'People in low-motivation or low-energy phases',
    title: 'AI for depression daily tasks',
    h1: 'Gentle daily-task support when motivation is low.',
    description:
      'Lifecoach helps with depression and executive function by shrinking admin, planning low-energy days, and keeping next steps realistic.',
    opener:
      'Some days the problem is not knowledge; it is energy. Lifecoach helps you lower the bar without giving up on yourself, choosing actions that respect low motivation, fog, and the effort it takes to restart.',
    keyphrases: [
      'AI for depression daily tasks',
      'depression and executive function app',
      'low motivation planner',
    ],
    useCases: [
      'When basic admin has piled up and the shame is heavier than the task.',
      'When you need a bare-minimum day plan that still protects tomorrow-you.',
      'When you want to message someone but cannot find the words.',
      'When reflection would help but journaling feels too open-ended.',
    ],
    ctaPrompt: 'Help me make a bare-minimum plan for a low-motivation day.',
    faqs: [
      {
        question: 'Is this mental-health treatment?',
        answer:
          'No. Lifecoach does not diagnose, treat, or replace professional support. It focuses on practical daily planning and gentle accountability.',
      },
      {
        question: 'What if I cannot do the plan?',
        answer:
          'The assistant can resize the plan, help you identify what was too hard, and keep the next step compassionate rather than punitive.',
      },
    ],
  },
  {
    slug: 'anxiety',
    audience: 'Anxious users and rumination loops',
    title: 'AI to calm anxiety and rumination',
    h1: 'A calmer way to work through anxious loops.',
    description:
      'Use Lifecoach to sort anxious thoughts, track rumination themes, and choose practical grounding steps.',
    opener:
      'Anxiety can make every option feel risky and every message feel loaded. Lifecoach gives the worry somewhere structured to go, then helps separate signals, stories, and one safe next action.',
    keyphrases: ['AI to calm anxiety', 'rumination tracking app', 'anxiety planning assistant'],
    useCases: [
      'When you are replaying the same conversation and need a reality-check structure.',
      'When a decision feels impossible because every path has a what-if.',
      'When you need to prepare for a meeting without spiralling.',
      'When you want to notice recurring worry themes over time.',
    ],
    ctaPrompt: 'Help me untangle an anxious thought loop and choose one grounded action.',
    faqs: [
      {
        question: 'Can Lifecoach calm panic?',
        answer:
          'It can suggest grounding and planning prompts, but it is not emergency or clinical care. If you are in immediate danger, contact local emergency services or a crisis line.',
      },
      {
        question: 'Can it track rumination patterns?',
        answer:
          'Yes. It can help you reflect on repeated themes and turn them into practical experiments or boundaries.',
      },
    ],
  },
  {
    slug: 'wellness',
    audience: 'General health and wellbeing planning',
    title: 'AI wellness coach for everyday routines',
    h1: 'Wellness support that fits the day you actually have.',
    description:
      'A conversational AI wellness coach for sleep, movement, nutrition, reflection, and small sustainable routines.',
    opener:
      'Wellness advice often assumes a perfect week. Lifecoach starts with your real calendar, weather, energy, and obligations, then helps you pick routines that can survive contact with Tuesday.',
    keyphrases: ['AI wellness coach', 'sleep movement nutrition support', 'daily wellness planner'],
    useCases: [
      'When you want movement that fits between meetings instead of a fantasy gym plan.',
      'When sleep, food, and stress are tangled and you need a simple experiment.',
      'When you want to notice patterns without building a spreadsheet.',
      'When you need encouragement that is practical, not preachy.',
    ],
    ctaPrompt: 'Help me make a realistic wellness plan for today.',
    faqs: [
      {
        question: 'Does Lifecoach give medical advice?',
        answer:
          'No. It can help with habits and reflection, but medical concerns should go to qualified clinicians.',
      },
      {
        question: 'Can it adapt to my context?',
        answer:
          'Yes. Lifecoach can account for your stated goals, time of day, local context, and connected Workspace information when available.',
      },
    ],
  },
  {
    slug: 'career',
    audience: 'Career coaching and work-direction questions',
    title: 'AI career coach for direction and negotiation',
    h1: 'Career coaching for the messy middle of work.',
    description:
      'Lifecoach helps with career direction, interview prep, salary negotiation, and turning ambition into next actions.',
    opener:
      'Career growth is rarely one clean decision. It is confidence, timing, emails, trade-offs, money, and the quiet fear of choosing wrong. Lifecoach helps you reason through the next move and draft the awkward parts.',
    keyphrases: ['AI career coach', 'career direction app', 'salary negotiation AI'],
    useCases: [
      'When you need to prepare for an interview without over-preparing forever.',
      'When you want to draft a salary negotiation or boundary-setting message.',
      'When you are choosing between roles, projects, or paths.',
      'When your goals need a weekly execution plan.',
    ],
    ctaPrompt: 'Help me think through my next career move and choose one action.',
    faqs: [
      {
        question: 'Can Lifecoach help with salary negotiation?',
        answer:
          'It can help structure your case, draft language, and rehearse likely responses. It does not replace legal, financial, or professional advice.',
      },
      {
        question: 'Is this only for job seekers?',
        answer:
          'No. It can support people deciding what to prioritise, how to communicate at work, and how to build momentum in their current role.',
      },
    ],
  },
  {
    slug: 'menopause',
    audience: 'Perimenopause and menopause support',
    title: 'Menopause symptom coach and daily support',
    h1: 'Daily planning support through peri/menopause fog.',
    description:
      'A menopause symptom coach for tracking patterns, planning around energy, and handling work and home admin with more compassion.',
    opener:
      'When sleep, mood, memory, heat, and energy all fluctuate, generic productivity advice can feel insulting. Lifecoach helps you notice patterns and plan the day around the body you have right now.',
    keyphrases: [
      'menopause symptom coach',
      'perimenopause AI support',
      'menopause brain fog planner',
    ],
    useCases: [
      'When brain fog makes routine admin feel strangely hard.',
      'When symptoms, sleep, and workload need to be looked at together.',
      'When you need language for a doctor appointment or workplace boundary.',
      'When a normal plan needs a low-energy version.',
    ],
    ctaPrompt: 'Help me plan around brain fog and low energy today.',
    faqs: [
      {
        question: 'Does Lifecoach diagnose menopause symptoms?',
        answer:
          'No. It can help you track patterns and prepare questions, but diagnosis and treatment belong with qualified clinicians.',
      },
      {
        question: 'Can it help me prepare for appointments?',
        answer:
          'Yes. It can organise symptoms, timelines, questions, and examples so appointments are easier to use well.',
      },
    ],
  },
  {
    slug: 'personal-assistant',
    audience: 'Calendar, email, and task triage',
    title: 'AI personal assistant for ADHD admin',
    h1: 'A personal assistant for the admin that clogs your head.',
    description:
      'Connect Workspace so Lifecoach can help with inbox triage, calendar planning, tasks, and ADHD-friendly daily admin.',
    opener:
      'The hard part is not having a to-do list; it is deciding what to do with every email, meeting, promise, and half-remembered obligation. Lifecoach turns scattered admin into decisions you can actually make.',
    keyphrases: [
      'AI personal assistant ADHD',
      'inbox triage AI',
      'task management for ADHD adults',
    ],
    useCases: [
      'When your inbox needs decisions, drafts, and follow-up tasks separated.',
      'When your calendar is overfull and something has to move.',
      'When a task list needs to become a realistic today list.',
      'When you need help translating loose intent into Calendar, Gmail, or Tasks action.',
    ],
    ctaPrompt: 'Help me triage my inbox, calendar, and task list into a realistic plan.',
    faqs: [
      {
        question: 'Does Lifecoach access my Workspace by default?',
        answer:
          'No. Workspace access is optional and only happens when you connect Google Workspace.',
      },
      {
        question: 'Are Workspace tokens sent to the model?',
        answer:
          'No. Tokens stay in the app layer; the model receives only the scoped context needed to help with your request.',
      },
    ],
  },
] satisfies HelpTopic[];

export function getHelpTopic(slug: string) {
  return helpTopics.find((topic) => topic.slug === slug);
}

export type BlogPost = {
  slug: string;
  type: 'Evidence-backed' | 'Personal story';
  title: string;
  description: string;
  publishedAt: string;
  targetSubreddit: string;
  tags: string[];
  body: { heading: string; paragraphs: string[] }[];
};

export const blogPosts = [
  {
    slug: 'what-science-says-ai-coaching',
    type: 'Evidence-backed',
    title: 'What the science says about AI coaching for everyday change',
    description:
      'A practical reading of chatbot trials, behaviour-change research, and why daily support has to stay humble.',
    publishedAt: '2026-05-12',
    targetSubreddit: 'r/getdisciplined',
    tags: ['evidence', 'behaviour change', 'AI coaching'],
    body: [
      {
        heading: 'The useful claim is narrower than the hype',
        paragraphs: [
          'The strongest case for AI coaching is not that a bot can replace care, friendship, or professional advice. The useful claim is smaller: a conversational system can make reflection, planning, and follow-through easier to start at the exact moment someone would otherwise avoid the task.',
          'Published work around mental-health chatbots, habit design, and digital therapeutics points to the same product lesson: people need timely prompts, believable next steps, and a low-friction way to come back after the first plan fails.',
        ],
      },
      {
        heading: 'Design for relapse, not perfect streaks',
        paragraphs: [
          'Behaviour-change systems often overvalue the clean streak. Real lives are messier. A useful coach should notice interruptions, resize the plan, and help the user restart without turning the restart into a moral referendum.',
          'That is why Lifecoach focuses on warm accountability, small experiments, and context-aware planning rather than big motivational speeches.',
        ],
      },
    ],
  },
  {
    slug: 'staring-at-inbox-adhd-admin',
    type: 'Personal story',
    title: 'When you have been staring at your inbox for an hour',
    description:
      'An ADHD-shaped walkthrough of turning inbox paralysis into decisions, drafts, and a tiny next step.',
    publishedAt: '2026-05-12',
    targetSubreddit: 'r/ADHD',
    tags: ['ADHD', 'executive function', 'inbox triage'],
    body: [
      {
        heading: 'The inbox is not one task',
        paragraphs: [
          'Inbox paralysis usually looks irrational from the outside. From the inside, it is completely logical: every message hides a decision, an emotion, a dependency, a possible mistake, and a future consequence.',
          'The first move is not answering everything. It is sorting the pile into buckets: delete, reference, quick reply, needs decision, needs courage, and not today.',
        ],
      },
      {
        heading: 'Let the assistant hold the shape',
        paragraphs: [
          'A good AI assistant can keep the map visible while you handle one message at a time. It can draft the two-sentence reply, turn the hidden obligation into a task, and remind you that triage is progress even when the inbox is not empty.',
        ],
      },
    ],
  },
  {
    slug: 'bare-minimum-day-low-motivation',
    type: 'Personal story',
    title: 'The bare-minimum day is still a plan',
    description:
      'For low-motivation days, the win is not optimisation. It is protecting tomorrow-you with a plan small enough to do.',
    publishedAt: '2026-05-12',
    targetSubreddit: 'r/depression',
    tags: ['depression', 'low motivation', 'daily planning'],
    body: [
      {
        heading: 'Lowering the bar can be strategic',
        paragraphs: [
          'On a low-motivation day, ambitious planning can backfire. The plan becomes another reminder of what is not happening, and the shame makes even small tasks harder to approach.',
          'A bare-minimum plan asks a different question: what tiny actions would make tomorrow slightly less punishing?',
        ],
      },
      {
        heading: 'Three anchors are enough',
        paragraphs: [
          'Lifecoach often starts with three anchors: one body-supporting action, one admin action, and one connection or environment action. That might be water, one email, and opening the curtains. It counts because it changes the slope of the day.',
        ],
      },
    ],
  },
] satisfies BlogPost[];

export function getBlogPost(slug: string) {
  return blogPosts.find((post) => post.slug === slug);
}
