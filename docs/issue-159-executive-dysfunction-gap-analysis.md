# Issue 159 gap analysis: executive-dysfunction positioning and onboarding

- **Date:** 2026-05-15
- **Issue:** [timini/lifecoach#159](https://github.com/timini/lifecoach/issues/159)
- **Request summary:** update branding copy, how-tos, blogs, and onboarding so tranquil.coach more comprehensively supports users managing executive dysfunction; onboarding should ask whether there are life or health challenges the coach should know about so support can be tailored.
- **Scope of this analysis:** product, content, safety, data-model, and implementation gaps across the current web app and Python agent. This is not a clinical protocol and should not be treated as medical guidance.

## Evidence and constraints used

- The public issue body asks for stronger executive-dysfunction market positioning and for onboarding that explicitly invites disclosure of relevant life or health challenges.
- NIMH describes adult ADHD as affecting daily functioning through difficulties such as staying organized, keeping appointments, daily tasks, large projects, procrastination, time management, planning, and remembering tasks. NIMH also notes some adults use ADHD or life coaches for executive-function skills, while treatment remains medical/psychotherapeutic when needed.
- CDC frames adult ADHD support needs as changing across the lifetime and notes that diagnostic workups may need to rule out or account for anxiety, depression, sleep problems, substance misuse, learning disabilities, and other health problems that can resemble or co-occur with ADHD.
- NICE public guidance emphasizes information and support for adults with ADHD and their families/carers, which maps to clear user education and support boundaries.
- Existing product constraints: tranquil.coach is a practical coaching/planning assistant, not therapy, diagnosis, medication management, or crisis care. This boundary already appears in marketing copy and should remain central as the product leans harder into executive-dysfunction language.

## Current-state inventory

### Marketing and SEO

- `featurePages` already contains focused landing pages for overwhelm, ADHD, depression/low motivation, anxiety, wellness routines, career decisions, menopause brain fog, and inbox/calendar/task chaos. The ADHD page speaks directly to task initiation, transitions, prioritising, and body-doubling-style planning.
- The how-it-helps index routes users into those landing pages and describes them as focused landing rooms for exact stuck points.
- The homepage positions the product around ambient context, tiny decisions, and a warm memory layer that helps people act without feeling managed.
- Existing blog content covers AI coaching boundaries, ADHD inbox triage, and low-motivation day planning.

### Product onboarding and profile capture

- The first chat experience is intentionally low-friction: anonymous Firebase sign-in, then the chat UI renders starter prompts and an open composer.
- There is no explicit first-run onboarding screen, no structured consent moment, and no pre-chat profile intake for challenges, support needs, access needs, or health context.
- The agent currently captures durable facts opportunistically during normal conversation. The prompt instructs the model to save key health context, routines, preferences, people, and identity facts, using arbitrary profile paths when needed.
- The shared user profile is schema-free by design. Its starter shape includes `health.exercise_habits`, `health.sleep_quality`, `personality.challenges`, and `preferences.coaching_focus`, but no first-class fields for executive-function challenges, neurodivergence, accommodations, support style, sensitivities, crisis preferences, or consent/version metadata.
- Settings can show and edit the generic profile tree, but the user is not guided through a plain-language review of sensitive context.

### Agent behaviour

- The system prompt favours short, breathable replies; one question at a time; choice widgets over open questions when options are obvious; and shame-free support.
- The prompt can save health facts silently, which is useful for low-friction memory but risky if health-sensitive facts are captured before the product has clearly explained what is remembered, where it appears, and how to change/delete it.
- Existing practices support rituals such as day planning and gratitude, but there is no executive-function practice pack for task initiation, stuck-state triage, transition support, decision narrowing, or body-doubling check-ins.

## Gap map

| Area | What exists | Gap | Impact | Priority |
| --- | --- | --- | --- | --- |
| Brand promise | Warm, non-corporate coach; focused pages mention ADHD/overwhelm. | No explicit umbrella positioning for "executive dysfunction" as the product's core support category. | Users with ADHD, depression, burnout, autism, menopause fog, chronic illness, grief, or stress may not recognise themselves unless they land on a specific page. | P0 |
| Safety boundary | Some page FAQs say the product is not therapy/medical care. | Boundary is not systematically repeated in onboarding, profile intake, blog CTAs, and health-context capture. | Higher regulatory/trust risk as health disclosures become intentional. | P0 |
| First-run onboarding | Chat starts immediately with generic starter prompts. | No opt-in question about challenges, health context, access needs, support style, or what not to do. | Coach cannot tailor support until the user happens to disclose context; users with low executive function must do the work of explaining. | P0 |
| Consent and memory | Agent silently saves durable facts. | No user-facing explanation of sensitive memory, no consent version, no review step after sensitive capture. | Trust gap for health/neurodivergence data. | P0 |
| Profile schema | Schema-free profile has generic `health`, `personality`, and `preferences`. | No recommended taxonomy for support needs, executive-function profile, accommodations, triggers, sensory/cognitive constraints, or preferred coaching modes. | Future prompt behaviour, settings UI, and analytics may fragment around invented keys. | P0 |
| How-to content | Three starter blog posts exist. | Missing practical how-tos for task initiation, transitions, prioritisation, overwhelm triage, email/calendar/task debt, low-energy planning, ADHD/autism-friendly routines, and caregiver/family support. | SEO and activation gap; landing pages lack enough educational depth. | P1 |
| Blog governance | Blog metadata has tags and subreddit targeting. | No editorial safety checklist for health claims, citations, crisis language, diagnosis boundaries, or accessibility reading level. | Copy changes could drift into clinical claims. | P1 |
| In-chat routines | Existing practices are generic day planning/gratitude/journaling. | No named executive-function micro-practices that can be enabled or triggered contextually. | Product promise may not translate into repeatable help. | P1 |
| Settings UX | Generic profile tree and practices tab. | No plain-language "what the coach knows about my support needs" card, edit affordance, or deletion/retraction flow for sensitive fields. | Users cannot easily correct sensitive tailoring context. | P1 |
| Measurement | General analytics events exist for chat actions and account/workspace flows. | No activation metrics for onboarding completion, challenge disclosure, support-style selection, or whether tailored support improves first-session outcomes. | Hard to validate issue 159 improvements. | P1 |
| Internationalization | English/French chat labels exist. | New onboarding and health copy must be translated at launch, not English-only. | French users get inconsistent onboarding and consent semantics. | P1 |

## Recommended positioning update

### Core message

Move from "AI life coach that prevents overwhelm" to a more precise, inclusive wedge:

> tranquil.coach helps when executive function is the bottleneck: starting, choosing, remembering, switching, prioritising, replying, and recovering without shame.

This preserves the current warm tone while making the category legible. Use "executive-function support" more often than "productivity" because the target user is often blocked by activation energy, working memory, time blindness, sensory load, anxiety, grief, pain, burnout, hormonal change, or depression rather than lack of ambition.

### Audience framing

Avoid making ADHD the only doorway. A better umbrella:

- ADHD and late-diagnosed neurodivergent adults.
- Autistic users who need low-demand planning, transition support, or sensory-aware routines.
- Users with depression, burnout, grief, chronic illness, pain, fatigue, sleep disruption, perimenopause/menopause brain fog, anxiety, or caregiving overload.
- People who do not identify with a condition but know that starting, switching, remembering, or prioritising is hard right now.

### Copy principles

- Say **support**, **planning companion**, **daily admin**, **activation energy**, **next tiny step**, **body-double style**, **transition support**, **decision narrowing**, and **shame-free**.
- Avoid saying **treatment**, **diagnosis**, **clinical**, **therapy replacement**, **cure**, **manage your ADHD**, or **fix executive dysfunction**.
- Pair every health-context invitation with control language: "share only what feels useful", "skip anything", "edit/delete later", "not for emergencies", "not medical advice".

## Onboarding gap analysis

### Current gap

The chat page has only starter prompts and no structured first-run intake. The prompt can learn over time, but issue 159 asks for a proactive check-in before the coach starts tailoring care. The main product risk is adding too much intake and increasing abandonment for exactly the users who have the least spare executive function.

### Target onboarding shape

Use a **progressive, skippable, two-step intake** rather than a long form.

1. **Tiny first-run card before or above the first message**
   - Heading: "Anything the coach should know before we make a plan?"
   - Body: "You can share health, life, access, or attention challenges only if they would help me support you. Skip this if you want to start chatting."
   - Choices:
     - "ADHD / attention / task initiation"
     - "Low mood / low energy"
     - "Anxiety / rumination"
     - "Burnout / stress"
     - "Chronic illness / pain / fatigue"
     - "Menopause / hormone-related brain fog"
     - "Caregiving / family load"
     - "Something else"
     - "Skip for now"

2. **Support-style follow-up only if the user opts in**
   - "What kind of help usually works best?"
   - Multi-select:
     - "Very small steps"
     - "Prioritise for me"
     - "Body-double style check-in"
     - "Gentle tone, no pressure"
     - "Direct and brief"
     - "Reminders to eat/rest/move"
     - "Avoid long lists"
     - "Help with messages/admin"

3. **Optional free-text context**
   - Prompt: "Anything specific I should remember? Keep it short; you can edit it later."
   - Store as a single profile/memory note only after clear consent.

4. **Confirmation**
   - "Got it. I’ll use this to tailor plans, not to diagnose or treat. You can change it in Settings."

### Suggested profile paths

Keep the schema-free model, but standardize recommended keys so the prompt, settings UI, and analytics do not drift:

```yaml
support:
  onboarding_completed_at: "2026-05-15T00:00:00Z"
  consent_version: "support-context-v1"
  challenges:
    - adhd_attention_task_initiation
    - low_energy
  life_context:
    - caregiving_load
  health_context:
    user_disclosed: true
    notes: "Chronic fatigue makes mornings unreliable"
  access_needs:
    - avoid_long_lists
    - single_next_step
  coaching_style:
    tone: gentle
    planning_depth: tiny_steps
    accountability: body_double_style
  avoid:
    - shame_language
    - productivity_pressure
```

Do not infer diagnoses from behaviour. Store only user-disclosed conditions or challenge categories, and phrase categories as support needs where possible.

## Content gap analysis

### Landing pages to add or revise

1. **Executive dysfunction hub** (`/how-it-helps/executive-function`)
   - Explain starting, switching, remembering, prioritising, and recovering.
   - Cross-link to ADHD, overwhelm, depression, anxiety, menopause fog, and workspace pages.
   - CTA prompt: "I’m stuck and need one humane next step."

2. **Task initiation page**
   - For users who know what to do but cannot start.
   - Emphasize opening-the-document scripts, two-minute ramps, body-double check-ins, and friction removal.

3. **Transitions and context switching page**
   - From bed to day, work to home, meeting to task, scrolling to sleep.
   - Tie to calendar context and gentle transition scripts.

4. **Time blindness and planning page**
   - Support estimating, buffering, sequencing, and choosing a smaller day.

5. **Chronic illness / fatigue planning page**
   - Capacity-aware planning, pacing, rest as a valid plan, and no medical claims.

### Blog/how-to backlog

P0/P1 articles:

- "Executive dysfunction is not laziness: how to plan when starting is the hard part"
- "A 5-minute task initiation script for ADHD brains"
- "How to make a plan when you have low energy, pain, or fatigue"
- "The transition checklist: moving from stuck to started without a productivity spiral"
- "How to triage inbox-calendar-task debt when every item feels urgent"
- "What to tell an AI coach so it can support ADHD, burnout, or health constraints safely"
- "What AI coaching can and cannot do for executive dysfunction"

Each piece should include:

- one practical script users can copy into chat;
- a boundary note that the app does not diagnose or treat;
- a "when to seek human/professional support" section;
- short sections and low reading burden;
- internal links to the relevant support page and `/chat?prompt=...`.

## Agent and UX implementation gaps

### Minimum viable implementation

- Add first-run onboarding state in the web app, likely keyed to the current Firebase UID and agent profile state.
- Add a small support-context intake component that uses choice chips and optional free text.
- Persist onboarding answers through `PATCH /api/profile` into standardized `support.*` paths.
- Inject the resulting profile as the agent already does; update the prompt with a concise support-context directive so the model uses the data without over-medicalizing.
- Add settings UI that surfaces `support.*` in plain language with edit/delete controls.
- Add tests for onboarding state, profile writes, i18n labels, and prompt behaviour.

### Prompt changes needed

Add a block such as:

```text
SUPPORT_CONTEXT:
If the user has disclosed support.challenges, support.access_needs, support.coaching_style, or support.avoid, tailor the next step accordingly.
Never diagnose, validate diagnoses you cannot know, or imply treatment.
Prefer one small step, choice widgets, reduced typing, and explicit permission to stop.
If health or safety risk appears, encourage appropriate human/professional support.
```

### Safety and privacy requirements

- Make onboarding optional and skippable.
- Explain what will be remembered before saving health/access context.
- Add a clear setting to remove support context.
- Avoid collecting diagnosis labels unless user-provided.
- Do not use onboarding answers for ads or public analytics labels.
- Keep crisis/medical limitation language close to health-context prompts.
- Ensure logs and analytics avoid raw health text; use coarse event names only.

## Suggested rollout plan

### Phase 1: Content and copy foundation

- Add executive-function hub page and update homepage/how-it-helps copy.
- Add two high-intent articles: task initiation and safe support-context onboarding.
- Add editorial checklist for health-adjacent copy.

### Phase 2: Lightweight onboarding

- Add skippable support-context card in chat.
- Save standardized `support.*` profile paths.
- Add English and French translations.
- Add settings review/edit/delete UI.

### Phase 3: Agent tailoring

- Add `SUPPORT_CONTEXT` prompt directive.
- Add tests for single-next-step, choice-widget preference, no diagnosis, and sensitive-memory acknowledgement.
- Create executive-function micro-practices: task-start ramp, transition bridge, inbox triage, low-energy day plan.

### Phase 4: Measurement and iteration

- Track anonymous aggregate funnel events: viewed onboarding, skipped, selected coarse categories, saved, edited, deleted.
- Track first-session success proxies: sent first message, accepted starter prompt, returned within 7 days, enabled a practice.
- Run copy tests around "executive function" vs. "overwhelm" language.

## Open questions

1. Should support-context onboarding be required before chat, shown after the first message, or shown only when the user chooses a health/executive-function landing-page CTA?
2. Should sensitive support context live only in the GCS profile, or should narrative notes also go to Vertex Memory Bank after explicit consent?
3. What deletion guarantees and UI copy are required for health-context removal?
4. Does the product want a general "executive dysfunction" page, or should it use the less clinical phrase "executive-function support" everywhere?
5. Should the app include crisis-resource copy in onboarding itself, or only in responses where risk is detected?

## Acceptance criteria for issue 159

- Users can understand from the homepage/how-it-helps pages that tranquil.coach helps with executive-function bottlenecks, not generic productivity.
- At least one landing page and two how-to/blog pieces directly address executive dysfunction/task initiation.
- First-run users are asked, in a skippable low-demand way, whether any life, health, attention, energy, or access needs should shape coaching.
- Disclosed support context is saved under standardized profile paths and visible/editable/deletable in Settings.
- The agent uses disclosed context to produce shorter, lower-demand, more tailored plans without diagnosing or making clinical claims.
- Tests cover onboarding profile writes, prompt tailoring, safety boundaries, and translations.

## External references reviewed

- [GitHub issue #159: onboarding tweaks to position better for helping with executive dysfunction](https://github.com/timini/lifecoach/issues/159)
- [NIMH: ADHD in Adults: 4 Things to Know](https://www.nimh.nih.gov/health/publications/adhd-what-you-need-to-know)
- [CDC: ADHD in Adults: An Overview](https://www.cdc.gov/adhd/articles/adhd-across-the-lifetime.html)
- [NICE: ADHD diagnosis and management, information for the public](https://www.nice.org.uk/guidance/ng87/informationforpublic)
