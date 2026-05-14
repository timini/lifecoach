export type FeaturePage = {
  topic: string;
  audience: string;
  title: string;
  metaTitle: string;
  description: string;
  h1: string;
  eyebrow: string;
  opener: string;
  keyphrases: string[];
  useCases: string[];
  ctaPrompt: string;
  faq: { question: string; answer: string }[];
  ogTone: string;
};

export const featurePages = [
  {
    topic: 'overwhelm',
    audience: 'Anyone whose day feels too big to start',
    title: 'Prevent overwhelm',
    metaTitle: 'AI assistant for overwhelm and daily admin | tranquil.coach',
    description:
      'tranquil.coach helps you stop spiralling, sort the next three moves, and turn overwhelm into one doable step.',
    h1: 'The AI assistant that prevents overwhelm.',
    eyebrow: 'Start here when everything feels too much',
    opener:
      'You know the feeling: seventeen tabs open, three messages you meant to answer yesterday, a body full of urgency, and no obvious first move. tranquil.coach sits with the mess, names what is actually happening, and helps you choose one small next action without making you perform productivity.',
    keyphrases: [
      'i feel overwhelmed app',
      'how to stop feeling overwhelmed',
      'AI assistant for overwhelm',
    ],
    useCases: [
      'When you have been staring at your inbox for an hour and still cannot tell which message matters.',
      'When the house, work, relationships, and health admin have merged into one loud cloud.',
      'When you need someone to help choose a next step that is kind enough to actually do.',
      'When a plan would help, but a 14-step plan would make you shut the laptop.',
    ],
    ctaPrompt: 'I feel overwhelmed and need help choosing the next tiny step.',
    faq: [
      {
        question: 'Is tranquil.coach therapy?',
        answer:
          'No. tranquil.coach is not a therapist or medical service. It is a practical planning companion for daily admin, reflection, and next-step support.',
      },
      {
        question: 'What makes this different from a todo app?',
        answer:
          'Todo apps store tasks. tranquil.coach helps you talk through the stuck point, reduce the list, and decide what is realistically doable now.',
      },
      {
        question: 'Can I use it for a five-minute reset?',
        answer:
          'Yes. You can start with one sentence, ask for a tiny plan, and leave with a scoped action instead of a full productivity system.',
      },
    ],
    ogTone: 'warm amber and soft green calm-focus gradient',
  },
  {
    topic: 'adhd',
    audience: 'ADHD adults and late-diagnosed neurodivergent users',
    title: 'ADHD executive function support',
    metaTitle: 'AI assistant for ADHD task initiation | tranquil.coach',
    description:
      'Executive function support for ADHD adults: task initiation, inbox triage, transitions, and body-doubling style planning.',
    h1: 'ADHD support for the moment before you start.',
    eyebrow: 'Executive function support without shame',
    opener:
      'Sometimes the problem is not knowing what to do. It is getting your brain to cross the tiny invisible bridge between knowing and starting. tranquil.coach helps with task initiation, prioritising, transitions, and the daily admin that piles up when your attention has been fighting fires all week.',
    keyphrases: ['AI assistant for ADHD', 'ADHD task initiation app', 'executive function support'],
    useCases: [
      'When you need a body-double style script for opening the document, not another motivational quote.',
      'When you have 38 tasks and need the three that matter before your medication window dips.',
      'When email, calendar, and Tasks need triage into “reply”, “schedule”, “delete”, and “not today”.',
      'When you are stuck in revenge bedtime procrastination and need a softer landing plan.',
    ],
    ctaPrompt: 'Help me start the ADHD task I have been avoiding.',
    faq: [
      {
        question: 'Does tranquil.coach replace ADHD treatment?',
        answer:
          'No. It is not diagnosis, therapy, or medication management. It is a practical assistant for planning, task initiation, and reducing daily friction.',
      },
      {
        question: 'Can it help with inbox triage?',
        answer:
          'Yes. With Workspace connected, tranquil.coach can help you reason about Gmail, Calendar, and Tasks while keeping OAuth tokens in the app layer.',
      },
      {
        question: 'Will it give long productivity lectures?',
        answer:
          'The product direction is short, warm, actionable support: fewer essays, more concrete next moves.',
      },
    ],
    ogTone: 'clear green focus card with gentle dopamine-friendly contrast',
  },
  {
    topic: 'depression',
    audience: 'People in low-motivation or low-energy phases',
    title: 'Depression and daily tasks',
    metaTitle: 'AI for depression daily tasks and executive function | tranquil.coach',
    description:
      'A gentle AI planning companion for low-motivation days: reduce tasks, pick one doable action, and keep a thread of care.',
    h1: 'Daily task support for low-motivation days.',
    eyebrow: 'When “just do it” is not a plan',
    opener:
      'On hard days, the dishes can feel like a wall and a simple reply can feel like carrying furniture upstairs. tranquil.coach helps lower the activation energy: fewer demands, more compassion, and one practical next step that respects the amount of battery you actually have.',
    keyphrases: [
      'AI for depression daily tasks',
      'depression and executive function app',
      'low motivation task support',
    ],
    useCases: [
      'When you need to choose between shower, food, message, or rest and everything feels equally impossible.',
      'When you want a plan that starts at “sit up and drink water”, not “optimise your morning routine”.',
      'When you need help sending one honest text instead of disappearing for another week.',
      'When you want to notice one win without pretending the day was easy.',
    ],
    ctaPrompt: 'I am low today. Help me pick one kind, doable task.',
    faq: [
      {
        question: 'Is tranquil.coach a crisis service?',
        answer:
          'No. If you might hurt yourself or someone else, contact local emergency services or a crisis hotline immediately. tranquil.coach is for everyday planning support, not emergency care.',
      },
      {
        question: 'Can it help when I have almost no energy?',
        answer:
          'Yes. You can ask for a tiny version of the day: food, hygiene, one admin action, or a low-pressure check-in.',
      },
      {
        question: 'Does it shame me for missed goals?',
        answer:
          'The copy and product direction are intentionally non-shaming: adjust the plan, keep the thread, try the next humane step.',
      },
    ],
    ogTone: 'soft blue dawn gradient with one practical step highlighted',
  },
  {
    topic: 'anxiety',
    audience: 'People stuck in rumination loops or anxious planning',
    title: 'Anxiety and rumination support',
    metaTitle: 'AI to calm anxiety and track rumination | tranquil.coach',
    description:
      'Use tranquil.coach to name the loop, separate facts from fears, and turn anxious energy into a grounded next move.',
    h1: 'A calmer place to put the anxious loop.',
    eyebrow: 'From rumination to the next grounded action',
    opener:
      'Anxiety can make every choice feel like a trapdoor. tranquil.coach gives the loop somewhere structured to land: what happened, what you know, what you are predicting, and what small action would actually help in the next ten minutes.',
    keyphrases: ['AI to calm anxiety', 'rumination tracking app', 'anxiety planning assistant'],
    useCases: [
      'When you keep rereading a message and need help drafting a normal human reply.',
      'When your calendar feels threatening and you need to distinguish preparation from panic.',
      'When you want to log a rumination pattern and decide whether any action is needed.',
      'When bedtime turns into a replay of every unresolved task.',
    ],
    ctaPrompt: 'Help me unpack an anxious loop and find one grounded action.',
    faq: [
      {
        question: 'Can tranquil.coach calm a panic attack?',
        answer:
          'tranquil.coach can offer grounding-style planning support, but it is not medical care. Seek professional or emergency help if symptoms feel unsafe or unmanageable.',
      },
      {
        question: 'Can it help with rumination?',
        answer:
          'Yes. The assistant can help capture the loop, separate facts from interpretations, and decide whether a next action is useful.',
      },
      {
        question: 'Will it encourage endless reassurance seeking?',
        answer:
          'The goal is to move from looping to a bounded next step, not keep feeding the same worry indefinitely.',
      },
    ],
    ogTone: 'quiet lavender and cream card for anxious loops',
  },
  {
    topic: 'wellness',
    audience: 'People wanting sleep, movement, nutrition, and reflection support',
    title: 'Everyday wellness coaching',
    metaTitle: 'AI wellness coach for sleep, movement, and nutrition | tranquil.coach',
    description:
      'A practical AI wellness coach that turns sleep, movement, food, and reflection goals into realistic daily choices.',
    h1: 'Wellness coaching that fits the day you actually have.',
    eyebrow: 'Sleep, movement, food, reflection — without perfectionism',
    opener:
      'Most wellness advice assumes a clean calendar, a stocked fridge, and a nervous system that loves routines. tranquil.coach starts with your actual day and helps choose the smallest health-supporting action that still counts.',
    keyphrases: [
      'AI wellness coach',
      'sleep movement nutrition support',
      'daily wellness assistant',
    ],
    useCases: [
      'When you need a movement plan that respects meetings, weather, and energy.',
      'When you want dinner to be “good enough” without turning food into a spreadsheet.',
      'When sleep needs a wind-down plan instead of another stern reminder.',
      'When reflection would help you notice patterns across mood, focus, and habits.',
    ],
    ctaPrompt: 'Help me make one realistic wellness choice today.',
    faq: [
      {
        question: 'Does tranquil.coach give medical advice?',
        answer:
          'No. It can support everyday planning and reflection, but medical decisions belong with qualified clinicians.',
      },
      {
        question: 'Can it use local context?',
        answer:
          'Yes, if you share browser location, tranquil.coach can consider context like weather when planning movement or errands.',
      },
      {
        question: 'Is the goal habit streaks?',
        answer:
          'Not necessarily. The product is designed around momentum, self-knowledge, and realistic next steps rather than brittle streaks.',
      },
    ],
    ogTone: 'fresh daylight wellness card with gentle habit cues',
  },
  {
    topic: 'career',
    audience: 'People navigating work direction, interviews, and negotiation',
    title: 'Career coaching',
    metaTitle: 'AI career coach for direction, interviews, and salary negotiation | tranquil.coach',
    description:
      'tranquil.coach helps turn career uncertainty into research, drafts, interview prep, negotiation scripts, and next actions.',
    h1: 'Career coaching for messy, real-world decisions.',
    eyebrow: 'Direction, interviews, salary, and the next email',
    opener:
      'Career decisions rarely arrive as neat pros-and-cons lists. They show up as avoidance, half-written applications, awkward recruiter messages, and a sense that your calendar is being run by everyone else. tranquil.coach helps turn the fog into concrete career moves.',
    keyphrases: ['AI career coach', 'career direction app', 'salary negotiation AI'],
    useCases: [
      'When you need to turn vague dissatisfaction into a shortlist of possible next roles.',
      'When a recruiter email needs a confident reply and your brain keeps making it weird.',
      'When interview prep needs stories, examples, and a realistic practice plan.',
      'When salary negotiation requires a script you can actually send.',
    ],
    ctaPrompt: 'Help me get unstuck on my next career move.',
    faq: [
      {
        question: 'Can tranquil.coach write applications for me?',
        answer:
          'It can help draft, structure, and refine materials, but you stay responsible for accuracy and final decisions.',
      },
      {
        question: 'Can it help with salary negotiation?',
        answer:
          'Yes. It can help clarify constraints, draft language, and rehearse scenarios so the next step is less intimidating.',
      },
      {
        question: 'Is this only for corporate careers?',
        answer:
          'No. The approach works for direction, creative work, independent projects, and practical admin around earning a living.',
      },
    ],
    ogTone: 'confident charcoal and warm accent career coaching card',
  },
  {
    topic: 'menopause',
    audience: 'People in peri/menopause balancing symptoms and daily life',
    title: 'Perimenopause and menopause support',
    metaTitle: 'Menopause symptom coach and perimenopause AI support | tranquil.coach',
    description:
      'Track patterns, plan around energy, and reduce daily admin friction during peri/menopause and menopause transitions.',
    h1: 'Support for peri/menopause brain fog, energy, and admin.',
    eyebrow: 'Plan around the body you are in today',
    opener:
      'Brain fog, sleep disruption, temperature swings, mood shifts, and the rest of life do not politely take turns. tranquil.coach helps you notice patterns and plan the day around current capacity without pretending symptoms are a character flaw.',
    keyphrases: [
      'menopause symptom coach',
      'perimenopause AI support',
      'menopause brain fog planning',
    ],
    useCases: [
      'When brain fog makes sequencing the day feel harder than the tasks themselves.',
      'When sleep disruption means the plan needs an energy budget, not wishful thinking.',
      'When symptom notes need to become clear talking points for a clinician appointment.',
      'When work and home admin need triage around unpredictable capacity.',
    ],
    ctaPrompt: 'Help me plan around brain fog and low energy today.',
    faq: [
      {
        question: 'Does tranquil.coach diagnose menopause symptoms?',
        answer:
          'No. It can help you track patterns and prepare questions, but diagnosis and treatment decisions belong with clinicians.',
      },
      {
        question: 'Can it help prepare for appointments?',
        answer:
          'Yes. You can ask it to organise symptom notes, questions, and examples so a short appointment is easier to use well.',
      },
      {
        question: 'Is this only for women?',
        answer:
          'No. tranquil.coach aims to support anyone experiencing peri/menopause symptoms, including trans and non-binary people.',
      },
    ],
    ogTone: 'warm rose and sage menopause planning card',
  },
  {
    topic: 'personal-assistant',
    audience: 'People who need calendar, inbox, and task triage',
    title: 'AI personal assistant',
    metaTitle: 'AI personal assistant for ADHD inbox and task triage | tranquil.coach',
    description:
      'Calendar, email, and task triage for people whose daily admin is the bottleneck — especially ADHD adults.',
    h1: 'An AI personal assistant for the admin pile.',
    eyebrow: 'Inbox, calendar, and tasks without the shame spiral',
    opener:
      'Daily admin has a way of becoming emotional admin: unanswered messages, unclear priorities, calendar dread, and the background hum that you have forgotten something. tranquil.coach helps triage the pile and turn it into replies, calendar moves, and a short list you can trust.',
    keyphrases: [
      'AI personal assistant ADHD',
      'inbox triage AI',
      'task management for ADHD adults',
    ],
    useCases: [
      'When Gmail is full of tiny decisions and you need help sorting reply, archive, defer, and schedule.',
      'When Calendar needs a realistic rearrange instead of pretending every block will fit.',
      'When Tasks has become a guilt museum and needs pruning back to what matters.',
      'When a vague intention needs to become a calendar hold, a task, or a drafted message.',
    ],
    ctaPrompt: 'Help me triage my inbox, calendar, and tasks.',
    faq: [
      {
        question: 'Does tranquil.coach connect to Google Workspace?',
        answer:
          'Yes. Workspace support can help with Gmail, Calendar, and Tasks while keeping OAuth tokens away from the model layer.',
      },
      {
        question: 'Can it make decisions for me?',
        answer:
          'It can recommend triage and next actions, but you remain in control of what gets sent, scheduled, or changed.',
      },
      {
        question: 'Why mention ADHD here?',
        answer:
          'Inbox and task triage are often executive-function bottlenecks. The page is written for that reality while remaining useful to anyone with admin overload.',
      },
    ],
    ogTone: 'organised desk card with inbox triage chips',
  },
] satisfies FeaturePage[];

export function getFeaturePage(topic: string) {
  return featurePages.find((page) => page.topic === topic);
}
