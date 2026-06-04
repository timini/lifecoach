# Issue #159 Gap Analysis: Executive-Function Positioning and Support-Needs Onboarding

## Context

GitHub issue [#159](https://github.com/timini/lifecoach/issues/159) asks Lifecoach to close two related product gaps:

1. Broaden branding, how-to, and blog copy for the executive-dysfunction market.
2. Improve onboarding so users can disclose life, health, accessibility, or executive-function challenges the coach should consider when tailoring support.

This analysis reviews the current repository against those goals and recommends a staged implementation path.

## Executive summary

Lifecoach is already directionally aligned with executive-function support. The marketing site explicitly addresses ADHD, overwhelm, low motivation, anxiety, menopause brain fog, and daily-admin overload. The product architecture also already supports personalization: profile, goals, memory, location, weather, and other routine context are injected into the agent prompt every turn rather than being fetched via model read tools.

The largest gap is not backend capability; it is the absence of a consent-forward onboarding flow that asks users what constraints, health context, accessibility needs, or executive-function challenges should shape coaching. Today the user can mention those facts in chat, and the coach may capture them, but users who need reduced-friction support must still self-advocate unprompted.

The second-largest gap is profile governance for sensitive support context. The profile is intentionally schema-free, which is useful, but the starter shape does not provide first-class conventions for support needs, executive-function barriers, accessibility preferences, consent state, or “avoid this style of coaching” preferences.

The third gap is content depth. The current positioning pages are strong seeds, but there is no single canonical executive-dysfunction hub and only a small blog/how-to surface for the many specific jobs-to-be-done in this market.

## Current strengths

### Architecture already supports personalization

The agent fetches routine context server-side and injects it into the system prompt. This is the right foundation for issue #159 because any support-needs data saved into the user profile can shape future turns without adding new model read tools.

Relevant current capabilities:

- The agent reads per-user profile data before prompt construction.
- The rendered prompt includes the full profile when present.
- The state machine and server decide tool availability and usage constraints outside the model.
- The settings UI already lets users inspect and edit remembered profile data.

### The profile contract is flexible

The shared `UserProfile` contract accepts arbitrary nested object data. This means the team can introduce a recommended `support_needs` convention without imposing a closed schema or breaking existing user profiles.

The starter profile already has broad areas such as `health`, `personality`, `goals`, and `preferences`, but these are not yet specific enough for support-needs onboarding.

### The agent already captures durable facts

The prompt tells the agent to capture durable identity, routine, preference, and health-context facts when they naturally appear. That makes passive capture possible today.

However, passive capture alone does not satisfy issue #159 because the user is never directly invited to disclose constraints that may affect coaching style.

### Marketing already has strong positioning seeds

Existing landing and feature-page copy already speaks to:

- ADHD task initiation and executive-function support.
- Overwhelm and daily admin overload.
- Depression and low-motivation days.
- Anxiety and rumination.
- Peri/menopause brain fog and energy planning.
- Calendar, inbox, and task triage.

This means the copy gap is mostly about consolidation, depth, and funnel completeness rather than a complete repositioning.

## Gap matrix

| Area | Current state | Gap | Impact | Priority |
| --- | --- | --- | --- | --- |
| Onboarding disclosure | Chat begins with generic starter prompts and optional account/location affordances. | No explicit “what should your coach know?” support-needs step. | Users with executive dysfunction must self-advocate unprompted. | P0 |
| Consent and sensitivity | The coach can silently capture durable facts, including health context, when mentioned. | No visible consent boundary for onboarding sensitive health, disability, or accessibility context. | Risk of feeling invasive or overreaching. | P0 |
| Profile structure | The starter profile has limited `health` and generic `personality.challenges` fields. | No recommended structure for executive-function barriers, accessibility, energy constraints, or coaching preferences. | Inconsistent profile paths make personalization harder to rely on. | P0 |
| Prompt policy | The prompt encourages one question at a time and low-friction choice tools. | No dedicated policy for how to use declared support needs safely. | The coach may ask too broadly, behave too clinically, or ignore disclosed constraints. | P0 |
| Product UI | Settings exposes a generic profile editor. | No friendly “Support needs” UI for review, edit, or deletion. | Raw profile editing is too high-friction for the target audience. | P1 |
| Marketing taxonomy | Feature pages cover adjacent topics such as ADHD, overwhelm, depression, anxiety, menopause, and personal assistant use cases. | No single executive-dysfunction hub or canonical message hierarchy. | SEO and product narrative are fragmented. | P1 |
| Blog/how-to content | A small blog surface exists, including an ADHD inbox article. | No broad how-to cluster for task initiation, low-energy planning, transitions, email avoidance, or appointment prep. | Fewer acquisition paths and weaker authority in the market. | P2 |
| Tests and evals | Profile rendering, schema-free profile behavior, and feature-page fields have coverage. | No tests for support-needs onboarding, consent wording, or adaptation based on declared constraints. | Regressions are likely as the feature grows. | P1 |

## Recommended product direction

### P0: Add a consent-forward support-needs onboarding step

Add an optional onboarding card early in the first-run experience:

> Anything your coach should know so support feels realistic?
>
> You can skip this. You can edit or delete it later.

Use multi-select chips before open text to reduce typing burden. Suggested challenge chips:

- ADHD or attention regulation.
- Autism or sensory needs.
- Anxiety, panic, or rumination.
- Depression or low motivation.
- Burnout or exhaustion.
- Chronic illness, pain, or fatigue.
- Peri/menopause or brain fog.
- Sleep disruption.
- Caregiving load.
- Grief or major life stress.
- Mobility or accessibility needs.
- Prefer not to say.
- Something else.

Then ask one follow-up at most:

> What kind of support usually works best?

Suggested support-style chips:

- Tiny next step.
- Body-doubling script.
- Fewer options.
- Gentle accountability.
- No shame or pressure.
- Reminders and check-ins.
- Help prioritizing.
- Help starting.
- Help stopping.
- Help with transitions.

### P0: Introduce a recommended `support_needs` profile convention

Keep the profile schema-free, but document and seed a predictable support-needs shape:

```yaml
support_needs:
  executive_function:
    task_initiation: null
    prioritization: null
    working_memory: null
    transitions: null
    time_blindness: null
    decision_fatigue: null
  health_context:
    user_disclosed_conditions: []
    energy_constraints: null
    sleep_constraints: null
    pain_or_fatigue: null
  accessibility:
    sensory_preferences: null
    communication_needs: null
    mobility_or_environment_constraints: null
  coaching_preferences:
    tone: null
    challenge_level: null
    preferred_plan_size: null
    accountability_style: null
    avoid: []
  consent:
    sensitive_context_opt_in: false
    last_reviewed_at: null
```

This structure gives the model a stable place to find support context while preserving the existing schema-free design.

### P0: Add explicit prompt policy for declared support needs

Add a prompt block near the existing style and information-capture guidance that tells the coach to:

- Treat declared challenges as context, not identity.
- Avoid diagnosis or medical claims.
- Avoid inferring health conditions from behavior.
- Ask before storing sensitive health, disability, or accessibility details unless the onboarding flow already captured explicit opt-in.
- Use smaller plans, fewer choices, and concrete initiation scripts when executive-function barriers are present.
- Prefer “what would make this easier to start?” over “why have you not done this?”
- Offer professional-support nudges where appropriate without making ordinary planning exchanges feel clinical.

### P1: Add a dedicated settings panel for support needs

Add a friendly settings section separate from the raw profile tree:

- What should your coach take into account?
- What kind of support helps?
- What should the coach avoid?
- Review sensitive context.
- Delete all support-needs or health-context data.

This can still patch the existing profile endpoint; the product gap is interaction design, not storage.

### P1: Consolidate the executive-function positioning spine

Create a clearer hierarchy across landing, feature, and blog pages:

1. Category: AI life-admin coach for executive dysfunction.
2. Audience: ADHD, autism, burnout, anxiety, depression, chronic illness, low-energy days, menopause brain fog, caregivers, and overloaded professionals.
3. Mechanism: one tiny next step, reduced decisions, context-aware planning, and non-shaming accountability.
4. Boundaries: not therapy, not diagnosis, not medication management.
5. Differentiator: remembers constraints and adapts how it helps.

### P2: Build a how-to content cluster

Prioritize practical pieces that map to high-intent executive-function searches:

- How to start a task when your brain refuses the first step.
- How to plan a low-energy day without pretending you have full battery.
- How to triage email when every message feels loaded.
- How to use body-doubling scripts with an AI coach.
- How to make a three-task day plan.
- How to prepare for an appointment when brain fog is high.
- How to recover from a missed deadline without shame spiraling.
- How to transition from work mode to home mode.
- How to ask for accommodations when you cannot explain the whole backstory.
- How to design reminders that do not become noise.

## Suggested implementation sequence

### Phase 1: Data and prompt groundwork

1. Document the `support_needs` profile convention.
2. Decide whether new users should receive an empty `support_needs` starter shape or whether it should be created only after onboarding.
3. Add prompt tests for support-needs context rendering and safe-use guidance.
4. Add shared profile tests if the starter template changes.

### Phase 2: Onboarding UI

1. Add a skippable first-run support-needs card.
2. Save multi-select answers into `profile.support_needs`.
3. Include clear copy that users can edit or delete the data later.
4. Track completion, skip, and edit events for funnel measurement.

### Phase 3: Agent behavior

1. Add a `SUPPORT_NEEDS` prompt block.
2. Add evals for ADHD task initiation, anxiety rumination, low-energy planning, and chronic-fatigue constraints.
3. Validate that the coach produces smaller plans, fewer options, and lower-shame language when support needs are present.

### Phase 4: Settings and data control

1. Add a Support Needs settings section.
2. Add bulk-delete for support-needs and health-context fields.
3. Make profile history visible enough that users can see when sensitive context was last changed.

### Phase 5: Marketing and content

1. Add an executive-dysfunction hub or refresh the landing page to make the positioning explicit.
2. Expand how-to/blog content around the recommended cluster.
3. Keep “not therapy, not diagnosis, not medication management” boundaries near health-adjacent claims.

## Acceptance criteria

A complete implementation of issue #159 should meet these criteria:

1. Onboarding gently asks whether the user has life, health, accessibility, or executive-function challenges the coach should consider.
2. The flow is optional, skippable, editable, and not framed as diagnosis.
3. The UI minimizes typing with chips, multi-select controls, and one follow-up at a time.
4. Answers save to a predictable profile location such as `support_needs.*`.
5. The agent adapts its coaching style based on declared support needs.
6. Users can review, edit, and delete sensitive support context in settings.
7. Marketing copy presents a coherent executive-function narrative across landing, feature, and blog pages.
8. Tests cover onboarding persistence, prompt rendering, support-needs behavior, and marketing page coverage.
9. Privacy and safety copy clearly distinguishes coaching support from therapy, diagnosis, or medical care.

## Risks and mitigations

- **Over-medicalization:** Keep support framed as planning, reflection, and daily-admin help rather than diagnosis or treatment.
- **Coercive disclosure:** Make support-needs onboarding optional and useful even when skipped.
- **Sensitive inference:** Do not infer health, disability, or neurodivergence from behavior. Store only user-disclosed context.
- **Schema drift:** Use a documented convention for `support_needs` while preserving the schema-free profile model.
- **High-friction controls:** Do not rely only on raw profile editing for a user group that often needs low-friction interfaces.

## Recommended follow-up tickets

1. Add `support_needs` profile convention and tests.
2. Build skippable support-needs onboarding UI.
3. Add prompt policy for declared constraints and consent-sensitive capture.
4. Add a Support Needs settings section with review/edit/delete controls.
5. Add an executive-dysfunction landing or hub page.
6. Publish the first four how-to articles: task initiation, low-energy planning, inbox triage, and appointment prep.
7. Add evals and product analytics for support-needs personalization quality.
