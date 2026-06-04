# Issue #159 executive-function onboarding and positioning gap analysis

## Source brief

GitHub issue [#159](https://github.com/timini/lifecoach/issues/159), opened on 2026-05-15, asks for onboarding and positioning changes so Lifecoach/tranquil.coach can serve people with executive-function challenges more comprehensively. The issue specifically calls for:

1. branding copy updates;
2. how-to and blog coverage for this market;
3. onboarding that asks whether the user has life or health challenges the coach should know about, so support can be better tailored.

The attached `Unified_Cognitive_Support_Brief.pdf` was not directly retrievable in this environment, so this analysis treats the issue body as the authoritative request and checks it against the current repository state.

## Executive summary

The repository is already substantially repositioned toward executive-function support at the marketing layer: the landing page names ADHD, burnout, anxiety, low energy, peri/menopause, and admin overload; the feature-page funnel has dedicated rooms for overwhelm, ADHD, low motivation/depression, anxiety, wellness, career, peri/menopause, and personal-assistant use cases; and several pages include appropriate therapy/medical boundary language.

The largest remaining gap is onboarding. First-run chat still starts with a generic blank-state prompt set and free-text composer. There is no explicit, consentful intake step that asks users whether executive-function, life, or health context should shape coaching. Profile infrastructure can store such context, and the agent prompt already encourages silent capture of durable health facts, but that capture is passive and opportunistic rather than a deliberate onboarding contract. This creates a product mismatch: the marketing promises tailored, executive-function-aware support before the runtime experience reliably gathers the context needed to deliver it.

## Current state inventory

### 1. Positioning and branding copy

**What exists now**

- The landing page positions tranquil.coach between productivity apps and therapy, emphasizing context-aware help that turns overwhelm into one humane next step.
- The landing page includes a trust/principles section that explicitly says the product is built for executive-function reality, including ADHD, burnout, anxiety, low energy, peri/menopause, and modern admin overload.
- The homepage imports and renders the feature-page collection, giving the funnel a single source of truth for use-case rooms.
- The “How it helps” index describes focused landing rooms for overwhelm, ADHD task initiation, low motivation, anxious loops, wellness routines, career decisions, peri/menopause fog, and inbox/calendar/task piles.

**Assessment**

Brand positioning is directionally strong and already close to the issue’s goal. It is less generic than a normal productivity app and avoids over-medicalizing the product. The main copy gap is not whether executive dysfunction is present; it is whether the promise is consistently translated into “how support adapts” across onboarding, settings, and help content.

**Gaps**

1. **No concise product-level thesis for cognitive accessibility.** The landing copy names the audience, but there is no crisp promise like “tell us what makes starting hard, and the coach adapts plans to your capacity, energy, communication preferences, and known constraints.”
2. **No repeated consent cue.** The marketing names sensitive categories, but does not clearly set the expectation that users control whether to share health/life context.
3. **Potential medical-boundary inconsistency.** Feature pages contain good disclaimers, but the homepage itself does not summarize the boundary between planning support and therapy/medical care.

### 2. Feature pages and SEO funnel

**What exists now**

The feature-page model defines eight stable topics:

- overwhelm;
- ADHD;
- depression/low motivation;
- anxiety;
- wellness;
- career;
- menopause;
- personal assistant/admin triage.

Several pages are especially aligned with issue #159:

- ADHD: task initiation, prioritization, transitions, medication-window awareness, inbox/calendar/task triage, and avoidance of long productivity lectures.
- Low motivation/depression: tiny first steps, low battery, food/hygiene/admin triage, crisis-service boundary.
- Anxiety: rumination loops, separating facts from fears, bedtime replay, bounded next actions.
- Wellness and menopause: energy-aware support, symptom-note organization, and clinician-boundary language.
- Personal assistant: inbox/calendar/task triage framed as an executive-function bottleneck.

**Assessment**

The feature-page inventory is the strongest part of the current implementation. It is broad enough to cover the market described in the issue while still creating search-specific pages. The tests also lock topic order and required SEO fields, which reduces regression risk.

**Gaps**

1. **No “how-to” library beyond the three current blog posts.** Blog infrastructure exists, and there are posts for ADHD inbox time, low motivation planning, and AI-coaching boundaries, but the issue asks for “how tos and blogs” more comprehensively.
2. **Limited content for co-occurring or situational challenges.** The funnel covers ADHD/anxiety/low motivation/menopause, but there is no dedicated guidance for burnout recovery, chronic illness/fatigue, grief/caregiving load, autism/sensory constraints, sleep disruption, medication timing, or overwhelm around appointments/forms.
3. **No internal journey from feature page to tailored intake.** Feature-page CTAs seed a prompt, but they do not carry structured topic context into onboarding or profile fields.

### 3. Blog and how-to coverage

**What exists now**

The blog loader reads MDX posts from `apps/web/content/blog`, enforces frontmatter fields, and renders posts sorted newest-first. The current content set contains three posts:

- `adhd-inbox-hour.mdx`;
- `low-motivation-day-plan.mdx`;
- `what-ai-coaching-can-and-cannot-do.mdx`.

**Assessment**

This is a good start, but it is not yet a comprehensive content strategy for the market. The current set maps to ADHD/admin, low motivation, and safety boundaries, but leaves many high-intent “how do I actually use this?” cases uncovered.

**Gaps**

1. **Missing onboarding/how-to posts.** Add posts such as “What to tell your AI coach if you have ADHD,” “How to ask for a plan when you are burned out,” and “How to use tranquil.coach without oversharing.”
2. **Missing life-context guides.** Add content for caregivers, chronic illness/energy limits, neurodivergent sensory constraints, grief, appointment prep, and work accommodations.
3. **Missing conversion continuity.** Existing posts should route readers into a tailored starter prompt or onboarding step rather than only a generic chat start.
4. **Missing trust content around sensitive data.** A plain-English “what we store, what you can edit, what not to share” article would support consentful onboarding.

### 4. First-run chat and onboarding UX

**What exists now**

ChatWindow initializes an anonymous Firebase user, renders a small empty-state caption, shows starter prompt cards from localized messages, and exposes a free-text composer. The default English starter prompts are generic: reflect on yesterday, plan a calmer morning, or identify one tiny action.

**Assessment**

This is intentionally low-friction, which is valuable for users with low energy or executive dysfunction. However, it does not satisfy the issue’s request to “check with the user if they have any challenges in their life or health that the coach should be aware of.” Users can volunteer context, but the product does not invite it in a structured, consentful, low-effort way.

**Gaps**

1. **No explicit intake step.** There is no first-run card or generated UI prompt asking whether the user wants to share support needs.
2. **No skip path with reassurance.** A good executive-function intake should be optional, skippable, and phrased as “only if useful.”
3. **No multi-select affordance for common support needs.** The system has choice-question UI support, but onboarding does not use it for “ADHD/executive function, anxiety/rumination, burnout/low energy, chronic health/energy limits, caregiving/family load, work/school pressure, sensory/social overload, prefer not to say.”
4. **No onboarding state.** The profile has no explicit `onboarding.support_context_completed_at`, `support_needs`, or `coaching_adjustments` fields to prevent repetitive intake.
5. **No escalation/safety pathway in onboarding.** Sensitive intake should include boundaries: not therapy, not emergency care, and crisis guidance when self-harm or immediate danger is disclosed.

### 5. Profile data model and settings

**What exists now**

The shared user profile is intentionally schema-free. The empty profile template includes `health.exercise_habits`, `health.sleep_quality`, `personality.challenges`, `preferences.communication_style`, `preferences.coaching_focus`, and `preferences.session_preference`. The settings UI renders the profile as an editable YAML tree and tells users the coach writes there as it gets to know them.

**Assessment**

The storage model is flexible enough to support issue #159 without a schema migration. That flexibility is useful because executive-function context is varied and personal. However, the starter template does not include the fields most relevant to tailored cognitive support, and the settings UI is too generic for a user to understand what context is useful to share.

**Gaps**

1. **Starter profile lacks support-specific fields.** Suggested additions: `support_context.challenges`, `support_context.health_considerations`, `support_context.energy_patterns`, `support_context.overwhelm_signals`, `support_context.helpful_support`, `support_context.unhelpful_support`, `support_context.safety_boundaries`, and `preferences.prompt_style`.
2. **No profile-review affordance for sensitive context.** Users can edit YAML, but there is no friendly “Support context” section with checkboxes/chips and plain-language copy.
3. **No consent metadata.** There is no clear marker that health/life context was user-provided voluntarily, when it was last reviewed, or whether the coach should actively use it.
4. **Risk of invisible capture.** The agent is encouraged to silently save durable health facts. That is convenient, but for sensitive health/life context, the product should balance silent capture with explicit review and easy correction.

### 6. Agent behavior and prompt support

**What exists now**

The system prompt has a warm, concise persona, asks at most one open question at a time, prefers choice tools when obvious answers exist, and instructs the agent to capture durable identity and health context. User profile, memories, calendar density, weather, location, goals, day phase, and practices are injected into the prompt every turn. The update-profile tool can write arbitrary dotted paths and explicitly lists key health context among facts to capture.

**Assessment**

The agent infrastructure is well suited to tailored support once context exists. It can store arbitrary fields and see them on later turns. The behavior gap is that the prompt optimizes for passive capture, not a first-run support-needs intake.

**Gaps**

1. **No onboarding directive.** The prompt has no rule such as “if the user has no support-context intake on file, offer a short optional setup.”
2. **No explicit coaching adaptations.** The prompt does not tell the model how to adapt when a user has ADHD, anxiety, low energy, chronic pain/fatigue, sensory overload, etc.
3. **No “do not over-ask” guard for sensitive intake.** The one-question rule helps, but a dedicated intake policy should avoid interrogating users or repeatedly asking about health.
4. **No structured mapping from support needs to response style.** For example: ADHD → externalize next action and reduce choices; anxiety → separate facts from predictions; low energy → minimum viable action; chronic illness → energy budget and pacing; menopause → symptom-aware planning; caregiving → constraints and handoffs.

### 7. Privacy, safety, and trust

**What exists now**

The product already emphasizes browser-only location, no IP geolocation, OAuth tokens staying out of the model layer, and therapy/medical disclaimers on relevant feature pages.

**Assessment**

Trust foundations are strong. The missing work is specific to sensitive onboarding: ask only for useful context, explain how it is used, allow skipping, allow editing/deletion, and prevent the assistant from sounding diagnostic.

**Gaps**

1. **No health/life-context consent microcopy.** Intake should explain: “Share only what you want. This helps me adapt plans; it is not medical care. You can edit it later.”
2. **No data-deletion completion.** Settings has “Delete all my data” marked coming soon, which is a concern if onboarding asks for sensitive context.
3. **No crisis/scope handling at intake.** If a user discloses immediate danger or self-harm, the system should direct them to emergency/crisis support rather than treating it as ordinary coaching context.
4. **No audit surface tailored to support context.** Profile history exists, but users need a simple way to see and edit sensitive support information.

## Recommended target experience

### First-run flow

Keep the current low-friction chat start, but add a skippable “Make support fit you” card before or alongside starter prompts.

Recommended flow:

1. **Welcome:** “Take a breath — we can start wherever you are.”
2. **Optional support-context card:** “Anything I should know so plans fit your real life? You can skip this.”
3. **Multi-select chips:**
   - ADHD / executive function;
   - anxiety or rumination;
   - burnout or low energy;
   - depression / low motivation;
   - chronic illness, pain, or fatigue;
   - peri/menopause or hormone-related symptoms;
   - caregiving / family load;
   - sensory or social overload;
   - work/school pressure;
   - prefer not to say.
4. **Follow-up single choice:** “How should I adapt?” with options like “tiny steps,” “fewer choices,” “body-double me,” “gentle accountability,” “direct and concise,” “help me plan around energy.”
5. **Persist profile:** write selected fields to `support_context` and `preferences`.
6. **Confirm and continue:** “Got it — I’ll keep plans small and energy-aware. What’s the first thing you want help with?”

This should be optional, reversible, and available later from settings.

### Profile shape proposal

Because the profile is schema-free, this can be introduced as a convention rather than a closed schema:

```yaml
support_context:
  challenges:
    - adhd_executive_function
    - anxiety_rumination
  health_considerations:
    - chronic_fatigue
  energy_patterns:
    best_time_of_day: morning
    crash_risk: afternoon
  overwhelm_signals:
    - many_open_tasks
    - inbox_avoidance
  helpful_support:
    - tiny_next_step
    - reduce_choices
    - body_double_style
  unhelpful_support:
    - long_plans
    - shame_or_streaks
  consent:
    user_shared: true
    use_for_tailoring: true
    completed_at: '2026-05-15T00:00:00Z'
preferences:
  communication_style: short_warm_direct
  coaching_focus: executive_function_support
```

### Agent behavior proposal

Add a prompt block that activates when support context exists and a separate onboarding block when it is missing.

Recommended adaptation rules:

- ADHD/executive function: reduce activation energy, name the first visible action, limit choices, use body-doubling language, avoid motivational lectures.
- Anxiety/rumination: distinguish facts from predictions, bound reassurance loops, move toward one grounded action.
- Low energy/depression: offer minimum viable tasks, include rest/food/hygiene as valid actions, avoid shame and streak framing.
- Chronic illness/fatigue/pain: plan by energy budget, pacing, recovery windows, and appointment prep; avoid medical advice.
- Peri/menopause: account for sleep disruption, brain fog, temperature/mood symptoms, and clinician-note preparation; avoid diagnosis.
- Caregiving/family load: identify dependencies, handoffs, scripts, and “good enough” thresholds.
- Sensory/social overload: reduce input, propose quieter options, and make exits/recovery explicit.

## Prioritized gap matrix

| Priority | Gap | Why it matters | Suggested implementation |
| --- | --- | --- | --- |
| P0 | No explicit support-context onboarding | Core issue requirement; marketing promises tailoring but first run does not collect context | Add skippable first-run support-context card plus multi-select and profile writes |
| P0 | No sensitive-context consent/boundary copy | Health/life context requires trust and clear scope | Add card microcopy, settings copy, and help/blog article on data use |
| P0 | Agent lacks first-run intake directive | Without prompt support, the model will only capture context opportunistically | Add prompt block keyed off missing `support_context.consent.completed_at` |
| P1 | Starter profile lacks support-context convention | Data can be stored, but there is no obvious place for it | Add conventional `support_context` fields to `emptyUserProfile()` and tests |
| P1 | Settings lacks friendly support-context editing | YAML is powerful but intimidating for sensitive data | Add a “Support context” settings section with chips and toggles |
| P1 | How-to/blog coverage is thin | Issue asks to accommodate the market comprehensively | Add 6-10 targeted posts and route each to seeded prompts/intake |
| P1 | Adaptation rules not centralized | Tailoring may be inconsistent across cases | Add `SUPPORT_CONTEXT_ADAPTATION` prompt block and tests/evals |
| P2 | Homepage lacks concise support-tailoring thesis | Existing positioning is good but not yet product-specific enough | Add a homepage section or hero sentence about optional context and adaptive plans |
| P2 | Delete-data path not complete | Sensitive onboarding raises user-control expectations | Implement or prioritize data deletion before aggressive sensitive intake |

## Suggested implementation sequence

### Phase 1: product copy and safe intake MVP

1. Add `support_context` starter fields to the empty profile template.
2. Add first-run support-context card in chat blank state.
3. Persist selections to profile via existing `/api/profile` or a smaller dedicated profile-update route.
4. Add prompt block for missing/completed onboarding.
5. Add tests for starter profile fields, chat blank state, and prompt output.

### Phase 2: settings and content support

1. Add a dedicated support-context settings panel.
2. Add copy explaining sensitive context, editing, and deletion.
3. Add 6-10 how-to/blog posts focused on executive-function use cases.
4. Link feature-page CTAs to topic-aware intake or seeded prompts.

### Phase 3: quality, safety, and personalization depth

1. Add eval cases for ADHD task initiation, anxious rumination, low-energy planning, chronic fatigue pacing, peri/menopause appointment prep, and caregiver overload.
2. Add a safety eval for self-harm/immediate danger disclosures.
3. Track onboarding completion and skip rates.
4. Implement data deletion before broad production rollout of sensitive-context intake.

## Acceptance criteria for issue #159

The issue should be considered complete when:

- new users are offered an optional, skippable support-context intake;
- selected life/health/executive-function context is saved in a clear profile convention;
- users can view and edit that context later;
- the agent prompt adapts style and planning based on that context;
- marketing and how-to content explain the executive-function positioning and boundaries;
- medical/therapy/crisis boundaries are visible in onboarding and relevant content;
- automated tests cover profile defaults, onboarding UI, prompt behavior, and core content inventory.
