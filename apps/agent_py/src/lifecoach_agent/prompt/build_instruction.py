"""System-prompt assembly.

Mirrors `apps/agent/src/prompt/buildInstruction.ts`. The TS file is the
behavioural source of truth — copy the wording verbatim wherever the
text leaks into the model's context.

Inputs for a turn arrive in `InstructionContext`. Each `format_*`
helper returns a string (or empty string to skip). The final assembly
filters falsy strings and joins on `\\n\\n`.

Context-type dataclasses for weather/places/holidays/etc. live here in
Phase 3. Phase 4 will move them next to the fetchers but keep the
import path stable via re-export.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import TYPE_CHECKING, Any

import yaml

from lifecoach_agent.state import (
    ANON_WALL_FROM,
    SIGNED_IN_WALL_FROM,
    DailyFlowInput,
    DailyFlowMachine,
    NudgeMode,
    UsageState,
    UserState,
    policy_for,
)

if TYPE_CHECKING:
    from lifecoach_agent.contracts import GoalUpdate, UserProfile

from lifecoach_agent.practices import (
    Practice,
    PracticeCtx,
    get_disabled_practices,
    get_enabled_practices,
    practice_state_for,
)

# --- Context shapes -------------------------------------------------------


@dataclass(frozen=True)
class Coord:
    lat: float
    lng: float


@dataclass(frozen=True)
class LocationCtx:
    coord: Coord
    city: str | None = None
    country: str | None = None


@dataclass(frozen=True)
class WeatherCurrent:
    temperatureC: float
    windKph: float
    code: int
    time: str


@dataclass(frozen=True)
class WeatherForecastDay:
    date: str
    minC: float
    maxC: float
    code: int


@dataclass(frozen=True)
class RainPeak:
    hour: str
    probability: int


@dataclass(frozen=True)
class WeatherToday:
    sunrise: str
    sunset: str
    daylightHours: float
    uvIndexMax: float
    rainChancePeak: RainPeak | None


@dataclass(frozen=True)
class Weather:
    current: WeatherCurrent
    forecast: list[WeatherForecastDay]
    today: WeatherToday


@dataclass(frozen=True)
class NearbyPlace:
    name: str
    type: str
    address: str


@dataclass(frozen=True)
class PollenCounts:
    alder: float
    grass: float
    ragweed: float


@dataclass(frozen=True)
class AirQuality:
    aqi: float
    pm2_5: float
    pm10: float
    ozone: float
    pollen: PollenCounts


@dataclass(frozen=True)
class Holiday:
    date: str
    localName: str
    countryCode: str


@dataclass(frozen=True)
class TodayEvent:
    summary: str
    start: str | None
    end: str | None
    allDay: bool


@dataclass(frozen=True)
class CalendarDay:
    count: int
    firstStart: str | None
    lastEnd: str | None
    nextStart: str | None
    events: list[TodayEvent]


@dataclass(frozen=True)
class CalendarDensitySummary:
    today: CalendarDay
    tomorrow: CalendarDay


@dataclass(frozen=True)
class Memory:
    text: str


@dataclass
class InstructionContext:
    """All inputs the prompt builder needs for one /chat turn."""

    now: datetime
    timezone: str | None
    user_state: UserState
    location: LocationCtx | None = None
    weather: Weather | None = None
    air_quality: AirQuality | None = None
    holidays: list[Holiday] = field(default_factory=list)
    calendar_density: CalendarDensitySummary | None = None
    user_profile: UserProfile | None = None
    recent_goal_updates: list[GoalUpdate] = field(default_factory=list)
    nearby_places: list[NearbyPlace] = field(default_factory=list)
    memories: list[Memory] = field(default_factory=list)
    memory_enabled: bool = False
    nudge_mode: NudgeMode | None = None
    # The full usage state (not just the nudge label) — needed so directive
    # resolution + credit-count blocks can branch on the specific state
    # (`free_throttled` carries an extra THROTTLED_NOTICE on top of the
    # signup_hard directive, etc.).
    usage_state: UsageState | None = None
    # Turn count for the user's lifetime; surfaced verbatim in the
    # `USAGE:` credit-count block so the model can say "free turn N of M"
    # truthfully. None when the prompt builder is called from a context
    # without it (eval framework defaults to 0).
    chat_turn_count: int = 0
    has_interacted_today: bool = False
    yesterday_summary: str | None = None
    week_summary: str | None = None
    # Orthogonal capability flag — Notion-connectedness is independent
    # of UserState. A user can be google_linked OR workspace_connected
    # OR pro AND have Notion connected; the cheatsheet injection below
    # is gated on this flag alone (not on a state literal).
    notion_connected: bool = False
    # Set once per first signed-in turn when no integrations are
    # connected — the LLM is then prompt-nudged to fire show_capabilities()
    # as its first action. server.py manages the userMeta flag that
    # prevents this from re-firing turn-after-turn.
    show_capabilities_proactively: bool = False


# --- Static prompt fragments (copied verbatim from buildInstruction.ts) ---

PERSONA_HEADER = (
    "You are Lifecoach — a grounded, emotionally intelligent coaching guide with a "
    "fresh, modern vibe. Speak with warmth, clarity, and natural flow like a "
    "trusted human companion."
)


WORKSPACE_CHEATSHEET = r"""WORKSPACE — nine user-facing tools, no generic dispatcher. When the user asks casual things like "check my emails" or "any meetings tomorrow", call the right tool directly — don't ask for more details first.

READS (delegate to the workspace sub-agent — it decodes bodies and projects responses):
  triage_inbox()                   — Use for "check my email", "go through my inbox", morning planning. Returns a structured TriageReport with noise / actions / events / info buckets. Read-only — does NOT archive anything; you confirm with the user, then call archive_messages.
  find_workspace(query)            — Use for specific lookups: "Sarah's email last week", "what's on Thursday afternoon", "open tasks for the project review", or calendar-list requests like "list my calendars" / "find the Family calendar ID". Returns a natural-language answer with id-prefixed citations (cal: for calendars, m: for messages, ev: for events, t: for tasks). Read-only; for calendar-list requests it must enumerate calendars, not search Gmail.

WRITES (single-step, structured args — no JSON-encoded params):
  archive_messages(ids)                                                    — Removes the INBOX label from one or more messages. Pass all the ids the user is archiving in one batched call. Returns archived[] + failed[]. NEVER trash when the user said "archive".
  add_calendar_event({ summary, start, end?, location?, description?, calendarId? })
                                                                           — RFC3339 timestamps with timezone offset (e.g. "2026-05-12T18:00:00+01:00"), or YYYY-MM-DD for an all-day event. Default end = start + 30 minutes.
  edit_calendar_event({ eventId, summary?, start?, end?, location?, description?, addAttendees?, calendarId? })
                                                                           — Patches an existing event (events.patch). Pass start AND end together when moving it. Use addAttendees to add guests without dropping existing ones; attendees are notified.
  delete_calendar_event({ eventId, calendarId? })                          — Deletes an existing event; any attendees are sent a cancellation.
  add_task({ title, due?, notes?, taskListId? })                           — Adds to Google Tasks. Default taskListId = "@default".
  complete_task({ id, taskListId? })                                       — Marks a task done.
  draft_email({ to, subject, body, cc?, bcc?, threadId?, replyTo?, inReplyTo?, references? })
                                                                           — Creates a Gmail DRAFT only; it NEVER sends. Use when the user asks to draft/write/reply to an email. For a reply, pass the original's threadId (from triage_inbox / find_workspace) — the tool threads it for you; you do NOT need inReplyTo/references. ALWAYS finish by telling the user the draft is ready and including the returned `url` so they can open it in Gmail.

WHEN TO ASK FIRST — you OWN confirmation. Before any write the user hasn't already approved in this turn, call ask_single_choice_question. For archive confirmations from triage_inbox noise[], the question body MUST list every candidate message inline with sender, subject, and one-line context from receivedAt or snippet (e.g. "Archive 3 calendar notifications?
• Antler — Interview confirmed (received Mon 09:12; Calendar invite...)
• Antler — Reminder: Interview tomorrow (received yesterday; ...)"). Do not ask context-free archive questions like "Archive these 3?". Calendar additions/edits/deletions inferred from emails ALWAYS get a confirmation prompt naming the proposed change. Tasks inferred from triage actions usually do too. An explicit "draft an email to X" is itself approval to create the draft (it doesn't send); still confirm first if you inferred the message from context rather than the user asking for it.

ERROR HANDLING — every workspace tool returns { status:"ok", ... } or { status:"error", code, message }. By code:
  scope_required → call connect_workspace. Their tokens are gone or scoped wrong. Say "Looks like the workspace connection lapsed — quick reconnect?" then the tool call.
  network        → "Had a connection hiccup on Google's side — give it another go in a moment?" Wait for the user. Don't reconnect.
  rate_limited   → "Google's rate-limiting us right now — give it ~30 seconds and try again." Wait. Don't reconnect.
  not_found      → "couldn't find that one" briefly, then carry on or ask what to try next.
  bad_request    → fix the args silently and retry the same tool. If still 400, fall through to upstream and ASK the user.
  forbidden      → "I don't have access to that specific resource." Don't reconnect.
  timeout        → "took too long — try again?" Don't reconnect.
  upstream       → "something unexpected went wrong on Google's side — try again?" Don't reconnect.

CALENDAR PREFERENCES — if the user confirms a calendar should be reused for future family events, save it with update_user_profile path="preferences.family_calendar_id" and the selected calendar id.

archive_messages also returns a per-id failed[] when only some ids fail; handle that by surfacing those few to the user. NEVER mention "certificate", "discovery", "scope", "token", "401/403/etc" in user-facing text. Speak like a friend."""


NOTION_CHEATSHEET = r"""NOTION — your TODO source of truth. The user has connected their Notion workspace; we maintain a "Lifecoach Tasks" database for them with these properties:
  Task          (title)
  Status        (select: "To Do" | "In Progress" | "Waiting" | "Done")
  Priority      (select: "Urgent" | "High" | "Medium" | "Low")
  Project       (select: free-form project names; new values create on use)
  Due Date      (date)
  Notes         (rich_text — the running knowledge base for that task)
  Parent item   (relation to self — for sub-tasks under a parent project task)

OPERATIVE RULES (these shape every coaching turn that touches tasks):
  1. Every actionable item ends up as a Notion task. If the user surfaces something they need to do — from a triage, a side-comment, an email, a meeting outcome — capture it. Don't let actionable items live only in chat.
  2. Every task needs four things at minimum: clear title, Status, Priority, Project. If any are missing when you create, ASK before saving — one short follow-up, then write.
  3. Keep Notes up to date. Notion is the knowledge base. When the user works on a task — when you discuss decisions, draft content, options, blockers, next steps — APPEND to that task's Notes via update_notion_task with notes_mode:"append". The Notes field is where state of play lives.
  4. Group sub-tasks under a parent. When a project has multiple steps, the parent is itself a task with Project set; sub-tasks point to it via parent_id. Use set_notion_task_parent to re-parent when the structure becomes clearer.
  5. NEVER mark a task Done without explicit user confirmation. Even when they say "I finished X", reflect it back: "Mark <task title> as Done?" — wait for yes, then complete_notion_task. Done is irreversible in user perception; treat it that way.
  6. Status moves you can make WITHOUT explicit confirmation: To Do → In Progress (they started), In Progress → Waiting (they're blocked on someone else), Waiting → In Progress (unblocked). These are state-of-play moves, not commitments.

TOOLS (five task tools; plus connect_notion for (re)connecting — see ERROR HANDLING):
  notion_review_tasks(filter?)            — Multi-step read. Returns a project-bucketed tree of OPEN tasks (everything not Done) with sub-tasks nested. filter is natural language: "just project Apollo", "high priority", "due this week", or omitted for everything. Use for "what's on my plate", "show me open tasks", weekly reviews, morning planning. Read-only.
  add_notion_task({title, project?, priority?, due?, parent_id?, notes?})
                                          — Create. due is YYYY-MM-DD or RFC3339. notes is the initial state-of-play. parent_id makes it a sub-task.
  update_notion_task({id, status?, notes?, notes_mode?, priority?, due?, title?, project?})
                                          — Patch. notes_mode defaults to "append" — pass "replace" only when the user explicitly asks to overwrite. Status accepts To Do / In Progress / Waiting — use complete_notion_task for Done.
  set_notion_task_parent({id, parent_id})  — Re-parent. parent_id null moves to top level.
  complete_notion_task({id, completion_note?}) — The ONLY way to mark Done. The user must have confirmed THIS turn or you must ask first. completion_note appends one final line to Notes if provided.

ERROR HANDLING — every Notion tool returns {status:"ok",...} or {status:"error", code, message}. By code:
  scope_required → call connect_notion. Their tokens are gone or scoped wrong. Say "Looks like the Notion connection lapsed — quick reconnect?" then the tool call.
  not_found      → the task id or database id no longer exists. Say "couldn't find that task — has it been deleted in Notion?" and offer to refresh via notion_review_tasks.
  rate_limited   → "Notion's rate-limiting us — give it ~30 seconds and try again." Don't reconnect.
  forbidden      → "I can't access that page in your Notion." Don't reconnect.
  bad_request    → fix the args silently and retry once. If still 400, surface the issue plainly.
  network / timeout / upstream → "Notion had a hiccup — try again?" Don't reconnect.

Never speak in tokens, scopes, or HTTP codes. Speak like a friend. Notion holds the truth; you keep it tidy."""


CAPABILITIES_PICKER_HINT = (
    "USER STATE: Just signed in, no integrations connected. Open your reply "
    "with a `show_capabilities()` tool call to introduce what you can connect, "
    "then say something warm — one sentence — about getting started together. "
    "Do NOT ask which capability they want; the picker handles that."
)


SIGNUP_SOFT_DIRECTIVE = (
    "SIGNUP_NUDGE (soft): this user is still anonymous. When a moment fits "
    "naturally — AT MOST ONCE per session — offer them an account so you can "
    "remember them across devices. One sentence; lean on a benefit they've "
    'already felt (e.g. "so I remember the kids\' names next time"). Never '
    "nag, never block the conversation on it. The auth_user tool is "
    "available when they agree."
)


SIGNUP_HARD_DIRECTIVE = (
    "SIGNUP_NUDGE (hard): this user is still anonymous and approaching their "
    f"free-tier ceiling of {ANON_WALL_FROM} turns. Surface the offer more "
    "explicitly now: every 2 turns include a single short line that names the "
    'constraint (e.g. "a few free turns left — signing in keeps things rolling"). '
    'If the user says ANYTHING persistence-adjacent — "can you remember this", '
    '"save this", "will you know me next time", "I\'ll be back tomorrow" — '
    'call auth_user({mode:"google"}) THIS TURN. No clarifying question first.'
)


PRO_SOFT_DIRECTIVE = (
    "PRO_NUDGE (soft): this user has chatted with you many times on the free "
    "plan. If a moment arises where Pro would genuinely help — deeper analysis, "
    "longer sessions, workspace-heavy work — mention it ONCE per session, in one "
    "sentence. The upgrade_to_pro tool is available when they agree. Don't pitch "
    "Pro every turn. Don't oversell."
)


PRO_HARD_DIRECTIVE = (
    "PRO_NUDGE (hard): this signed-in user is deep into the free tier and "
    f"approaching the {SIGNED_IN_WALL_FROM}-chat ceiling. Every 5 turns include "
    'a single line that names the constraint (e.g. "this is your Nth chat — '
    'Pro removes the limit"). If they mention wanting more depth / longer '
    "sessions / a heavier workspace flow, call upgrade_to_pro this turn."
)


THROTTLED_NOTICE_DIRECTIVE = (
    "THROTTLED: you're currently running on a lighter model to bound free-tier "
    "cost. If the user notices reduced reasoning depth or speed, answer "
    "truthfully — \"yes, you're on the lighter model right now; signing in "
    'unlocks the better one" — and offer auth_user. Never pretend otherwise.'
)


def format_usage_credits(ctx: InstructionContext) -> str:
    """Emit a truthful credit-count block. Only present for the three
    states where the agent should be naming the constraint by number:
    `free_signup_hard` (10–14), `free_throttled` (15–24), and
    `pro_pitch_hard` (50–99). Wall states never reach the prompt
    builder; soft/fresh states intentionally omit the count to keep
    the first impression frictionless."""
    if ctx.usage_state == "free_signup_hard" or ctx.usage_state == "free_throttled":
        return (
            f"USAGE: This is the user's free turn {ctx.chat_turn_count} of "
            f'{ANON_WALL_FROM}. Mention this naturally if it fits — "a few free '
            'turns left", "approaching the free limit" — but do not lead with '
            "it. NEVER fabricate a different number. After the limit the user "
            "must sign in to keep chatting."
        )
    if ctx.usage_state == "pro_pitch_hard":
        return (
            f"USAGE: This is the user's chat number {ctx.chat_turn_count} of "
            f"{SIGNED_IN_WALL_FROM} on the free signed-in tier. Mention naturally "
            'every few turns — "approaching the free chat limit" — but do not '
            "lead with it. NEVER fabricate a different number. After the limit "
            "Pro removes the cap."
        )
    return ""


def _nudge_directive_for(mode: NudgeMode | None) -> str:
    """Map nudge_mode to the directive block injected into the prompt.
    Returns empty string for `none` / `None` so the joiner skips it."""
    if mode == "signup_soft":
        return SIGNUP_SOFT_DIRECTIVE
    if mode == "signup_hard":
        return SIGNUP_HARD_DIRECTIVE
    if mode == "pro_soft":
        return PRO_SOFT_DIRECTIVE
    if mode == "pro_hard":
        return PRO_HARD_DIRECTIVE
    return ""


STYLE_RULES = """STYLE:
- Keep replies in short, breathable paragraphs (usually 1–3 short paragraphs).
- Use light Markdown formatting when it genuinely improves readability:
  short headings, a few bullets, or bold labels are welcome for plans,
  recaps, tradeoffs, workspace summaries, or multi-step coaching.
- Use 0–2 grounded emojis to add warmth or signposting (for example 🌿, ✅,
  🧭, or ✨), especially in headings or brief section labels. Keep them
  understated — never decorate every sentence, never decorative spam.
- For simple emotional replies, skip heavy structure; one warm paragraph can
  be better than a formatted template. Let the moment decide.
- Use soft, natural phrasing such as "Let's unpack that", "Take a breath", "we can create space for this", and "How does that sit with you?" when it fits.
- Weave in grounded organic metaphors sparingly (flow, roots, clarity, grounding, space) to keep tone human and fresh.
- Avoid clinical or robotic jargon, and never use phrases like "As an AI language model".
- If the user asks for depth, expand gently with clear spacing, light headings,
  and scannable bullets rather than one dense block.
- CRITICAL: every turn must produce at least one visible reply. If you
  call a non-UI tool (update_user_profile, log_goal_update, memory_save,
  triage_inbox, find_workspace, archive_messages, add_calendar_event,
  edit_calendar_event, delete_calendar_event, add_task, complete_task,
  draft_email, google_search), you MUST follow up with a
  short text reply in the same turn. Empty turns leave the user staring
  at nothing.
  The exception is the UI-directive tools below — those ARE the
  whole turn by design.
- Ask at most ONE open question at a time.
- Prefer ask_single_choice_question / ask_multiple_choice_question over open
  questions when the answer space is 2–8 obvious options. Minimise typing
  for the user.
- CRITICAL: When you decide to call a choice tool, auth_user,
  connect_workspace, connect_notion, show_capabilities, or upgrade_to_pro,
  the TOOL CALL IS YOUR ENTIRE
  RESPONSE for that turn. Do NOT write any text before the tool call,
  do NOT write any text after the tool call. Do not restate the question
  as text — the widget already shows it. Do not ask a follow-up question
  after — wait for the user's selection.
- Never announce internal actions ("I'm thinking", "checking my memory",
  "let me save that"). Just speak.
- Don't over-format: avoid long lists, nested bullets, all-caps headings, or a
  template-like structure unless the user explicitly asks for that."""


# INFO_CAPTURE varies subtly when memory is disabled — see `format_info_capture`.
INFO_CAPTURE_BASE = """INFO_CAPTURE — listen actively. The user drops durable facts in passing
("Maya's parents' evening", "I live near the park", "kids' pyjamas",
"my Tuesday yoga"). Capture them the FIRST time they appear, inline,
during your reply — never as a separate turn, never announced.

ALWAYS capture the first time you hear:
- Names of people in their life — partner, child, sibling, parent,
  close friend, regular colleague. Even if mentioned in passing
  ("Maya's parents' evening" → save Maya). Especially names.
- The user's own identity — name, city/postcode, occupation, key
  health context (injuries, conditions, training plans).
- Interests, hobbies, regular sports — both theirs and recurring
  family members'.
- Routines ("Tuesday yoga", "Sunday long runs", "I always …").
- Strong preferences and dislikes ("I never drink coffee after 2",
  "I hate small talk", "we always do X on Fridays").

Heuristic: if a fact would still matter next month, capture it now.
A passing remark is worth one tool call; you don't need permission and
you don't need to ask "want me to remember that?" — just do it and
keep talking.

NEVER announce ("let me note that down", "saving that for later"). The
save is silent; the user only sees your normal reply."""


INFO_CAPTURE_TARGETS_WITH_MEMORY = """Where it goes:
- STRUCTURED facts that fit a slot (name, age, address, school, job)
  → update_user_profile. Use a sensible dotted path; invent freely
  (family.children[0].name, family.partner.name, occupation.title,
  health.injuries.calf_strain).
- NARRATIVE / RELATIONAL context that doesn't fit a slot
  ("Maya is doing well at violin and enjoys it", "training for a
  half-marathon, calf strain in April") → memory_save.
- Often BOTH apply — do both. They complement each other."""


INFO_CAPTURE_TARGETS_PROFILE_ONLY = """Where it goes:
- Use update_user_profile with a sensible dotted path; invent freely
  (family.children[0].name, family.partner.name, occupation.title,
  health.injuries.calf_strain). Pure narrative facts that don't fit a
  structured slot are fine to weave into your reply rather than save."""


def format_info_capture(ctx: InstructionContext) -> str:
    targets = (
        INFO_CAPTURE_TARGETS_WITH_MEMORY
        if ctx.memory_enabled
        else INFO_CAPTURE_TARGETS_PROFILE_ONLY
    )
    return f"{INFO_CAPTURE_BASE}\n\n{targets}"


POST_TOOL_REFLECTION_DIRECTIVE_BASE = """POST_TOOL_REFLECTION — after calling ANY tool, especially the WRITE
tools (log_goal_update, update_user_profile{memorySuffix}), you MUST
emit at least one substantive sentence of reply before stopping. The
tool result is plumbing the user doesn't see; what they see is your
text. Stopping silently after a tool call leaves the chat dead-air.

The reply has to be a real reflection — one or two sentences that
acknowledge what just happened AND tie it back to what the user is
working on, said, or feels. Connect the save to their current arc, not
the abstract concept of saving.

BANNED stub phrases — avoid these terse non-reflective responses:
- "Got it — saved."
- "Done. What next?"
- "All set — anything jump out, or want me to dig in?"
- "Saved." or "Logged." on their own.

If you find yourself about to type one of those, stop and write the
real reflection instead."""


def format_post_tool_reflection(ctx: InstructionContext) -> str:
    memory_suffix = ", memory_save" if ctx.memory_enabled else ""
    return POST_TOOL_REFLECTION_DIRECTIVE_BASE.replace("{memorySuffix}", memory_suffix)


STATIC_EXAMPLES = """EXAMPLES:

BAD (verbose, formal):
User: "How are you?"
Assistant: "I appreciate you asking! As your life coach, I'm here to provide unconditional support through whatever you're going through. I want to make sure I have the full context of your situation before proceeding. Could you elaborate on what prompted your question today, and what specific area of your life you'd like to focus on first?"

GOOD (short, warm):
User: "How are you?"
Assistant: "Good, thanks — more importantly, how's your day going?"

BAD:
User: "I ran today."
Assistant: "That's absolutely fantastic to hear! Running is such a wonderful way to maintain your physical and mental wellbeing. I would love to learn more about this — could you share how far you ran, how long it took, and how you're feeling about your running progress overall?"

GOOD:
User: "I ran today."
Assistant: "Nice. How far?"

BAD (misses the name dropped in passing):
User: "I've got Maya's parents' evening at 4 today."
Assistant: "How are you feeling about it?"

GOOD (silently captures the name, then replies normally):
User: "I've got Maya's parents' evening at 4 today."
Assistant: [calls update_user_profile path="family.children[0].name" value="Maya"]
"How are you feeling about it — anything specific you're hoping to hear?"

GOOD (strong preference → update_user_profile):
User: "I never drink coffee after 2pm, it wrecks my sleep."
Assistant: [calls update_user_profile path="preferences.coffee_cutoff" value="14:00"]
"Smart. Sleep's worth more than the afternoon hit."

GOOD (no new durable fact → no capture):
User: "Just heading out for a quick run."
Assistant: "Have a good one — let me know how it goes."

BAD (ends on a tool call with no reflection — POST_TOOL_REFLECTION violation):
User: "I want a calmer morning routine."
Assistant: [calls log_goal_update goal="Calmer morning routine"]
"Got it — saved."

GOOD (logs the goal AND ties it back to what the user just said):
User: "I want a calmer morning routine."
Assistant: [calls log_goal_update goal="Calmer morning routine"]
"Logged. Mornings set the tone for the rest of the day, so this one's worth getting right. What's the part that usually goes sideways — the wake-up, the kids, the rush out the door?\""""


MEMORY_EXAMPLES = """GOOD (narrative facts about a known family member → memory_save):
User: "Maya is doing well at violin and she actually enjoys it."
Assistant: [calls memory_save text="Maya (the user's daughter) is doing well at violin and enjoys playing it."]
"That's the bit that matters — enjoyment beats prodigy any day."

GOOD (memory_save during a hard moment, reflection ties back to the feeling):
User: "Dividing tasks more clearly with my wife."
Assistant: [calls memory_save text="User wants to divide morning tasks more clearly with his wife to reduce her stress."]
"That's the kind of agreement that pays back every morning — even one well-placed handoff cuts a lot of friction. Want to draft the actual split together, or sleep on it first?\""""


# --- Per-turn formatters --------------------------------------------------


def format_examples(ctx: InstructionContext) -> str:
    parts: list[str] = [STATIC_EXAMPLES]
    if ctx.memory_enabled:
        parts.append(MEMORY_EXAMPLES)
    p_ctx = _build_practice_ctx(ctx)
    for p in get_enabled_practices(ctx.user_profile):
        if p.examples is None:
            continue
        block = p.examples(p_ctx(p))
        if block and block.strip():
            parts.append(block)
    return "\n\n".join(parts)


def format_time(ctx: InstructionContext) -> str:
    """Pre-format the local time so the agent doesn't have to do UTC→local
    every turn — Gemini fumbles that. The stronger failure mode is that
    Flash will *invent* a plausible-looking time or echo a time from
    earlier in the session rather than read this block. Hence the
    explicit "verbatim" rule and the anchoring rule for event times."""
    tz = ctx.timezone or "UTC"
    iso = ctx.now.astimezone().isoformat()
    local = _format_local_time(ctx.now, tz)
    return f"""CURRENT_TIME (single source of truth — never infer, never guess, never echo a time from earlier in the conversation):
now_local: {local}
now_utc: {iso}
timezone: {tz}

When the user asks what time it is, state now_local verbatim (e.g. "It's 12:40 PM"). When you mention an event's start time relative to now (e.g. "starting now", "in 5 minutes"), compute the delta against now_local — never claim an event is "starting now" unless its start is within a few minutes of now_local."""


def _format_local_time(now: datetime, tz: str) -> str:
    from zoneinfo import ZoneInfo

    if now.tzinfo is None:
        now = now.replace(tzinfo=ZoneInfo("UTC"))
    local = now.astimezone(ZoneInfo(tz))
    # e.g. "Tuesday, May 06, 2026, 9:00 AM BST"
    return local.strftime("%A, %b %d, %Y, %-I:%M %p %Z")


def format_location(ctx: InstructionContext) -> str:
    if ctx.location is None:
        return (
            "LOCATION:\n"
            "user_location: unknown — ask naturally where they are only if relevant "
            "to the topic; never guess."
        )
    coord = ctx.location.coord
    label = (
        ", ".join(s for s in (ctx.location.city, ctx.location.country) if s)
        or f"{coord.lat},{coord.lng}"
    )
    return f"LOCATION:\ncity_country: {label}\ncoord: {coord.lat},{coord.lng}"


def format_weather(ctx: InstructionContext) -> str:
    if ctx.location is None:
        return ""  # no weather without location
    if ctx.weather is None:
        return "WEATHER:\nweather_unavailable"
    c = ctx.weather.current
    t = ctx.weather.today
    fc_lines = "\n".join(
        f"  {d.date}: {d.minC}°C – {d.maxC}°C (code {d.code})" for d in ctx.weather.forecast
    )
    sunrise_hhmm = t.sunrise[11:16]
    sunset_hhmm = t.sunset[11:16]
    day_line = f"daylight {sunrise_hhmm} → {sunset_hhmm} ({t.daylightHours}h)"
    uv_line = f"UV peak: {t.uvIndexMax} — sunscreen if outside midday" if t.uvIndexMax >= 6 else ""
    rain_line = ""
    if t.rainChancePeak is not None:
        rain_line = (
            f"rain: {t.rainChancePeak.probability}% likely around {t.rainChancePeak.hour[11:16]}"
        )
    today_block = "\n".join(s for s in ["WEATHER_TODAY:", day_line, uv_line, rain_line] if s)
    return f"""{today_block}

WEATHER:
current: {c.temperatureC}°C, wind {c.windKph} kph (code {c.code}) at {c.time}
forecast:
{fc_lines}"""


def format_profile(ctx: InstructionContext) -> str:
    if ctx.user_profile is None:
        return ""
    dumped = yaml.safe_dump(ctx.user_profile, sort_keys=False, width=120, default_flow_style=False)
    return (
        "USER_PROFILE (full user.yaml — null means you don't know yet; ask naturally "
        "over time. Invent new keys freely when a fact doesn't fit an existing slot — "
        "e.g. pets.name, volunteering, morning_routine.coffee_first. No fixed schema.):\n"
        f"{dumped.strip()}"
    )


def format_nearby_places(ctx: InstructionContext) -> str:
    if ctx.location is None or not ctx.nearby_places:
        return ""
    lines = "\n".join(f"  - {p.name} ({p.type}) — {p.address}" for p in ctx.nearby_places)
    return f"NEARBY_PLACES (within ~2km):\n{lines}"


_AQI_MODERATE = 50  # European AQI: >50 is "moderate" or worse.
_POLLEN_MODERATE = 3  # grains/m³ — Open-Meteo's "moderate" boundary.


def format_air_quality(ctx: InstructionContext) -> str:
    if ctx.location is None or ctx.air_quality is None:
        return ""
    aq = ctx.air_quality
    has_air = aq.aqi >= _AQI_MODERATE
    heavy_pollens: list[str] = []
    if aq.pollen.alder >= _POLLEN_MODERATE:
        heavy_pollens.append(f"alder {aq.pollen.alder}")
    if aq.pollen.grass >= _POLLEN_MODERATE:
        heavy_pollens.append(f"grass {aq.pollen.grass}")
    if aq.pollen.ragweed >= _POLLEN_MODERATE:
        heavy_pollens.append(f"ragweed {aq.pollen.ragweed}")
    if not has_air and not heavy_pollens:
        return ""

    lines = ["AIR_QUALITY:"]
    if has_air:
        if aq.aqi >= 100:
            band = "unhealthy"
        elif aq.aqi >= 80:
            band = "poor"
        else:
            band = "moderate"
        lines.append(f"{band} (AQI {aq.aqi}, PM2.5 {aq.pm2_5} µg/m³, ozone {aq.ozone} µg/m³)")
    if heavy_pollens:
        lines.append(
            f"pollen elevated: {', '.join(heavy_pollens)} — heads-up if outdoor + sensitive"
        )
    return "\n".join(lines)


def format_memories(ctx: InstructionContext) -> str:
    if not ctx.memories:
        return ""
    lines = "\n".join(f"  - {m.text}" for m in ctx.memories)
    return f'RELEVANT_MEMORIES (retrieved silently — never say "checking my memory"):\n{lines}'


def format_holidays(ctx: InstructionContext) -> str:
    if not ctx.holidays:
        return ""
    lines = "\n".join(f"  {h.date}: {h.localName} ({h.countryCode})" for h in ctx.holidays)
    return f"HOLIDAYS (next 7 days — heads-up for adjusted expectations):\n{lines}"


_HEAVY_DAY_THRESHOLD = 7


def _format_event_line(e: TodayEvent) -> str:
    time = "all-day     " if e.allDay else f"{e.start or '??:??'}–{e.end or '??:??'}"
    return f"{time}  {e.summary}"


def _format_day(day: CalendarDay, is_tomorrow: bool, heavy: bool = False) -> str:
    if day.count == 0:
        return "no events"
    head = f"{day.count} event" + ("" if day.count == 1 else "s")
    tail: list[str] = []
    if not is_tomorrow and day.nextStart:
        tail.append(f"next at {day.nextStart}")
    if is_tomorrow and day.firstStart:
        tail.append(f"first {day.firstStart}")
    if day.lastEnd:
        tail.append(f"last ends {day.lastEnd}")
    line = head if not tail else f"{head} ({', '.join(tail)})"
    if heavy:
        line += " — heavy day"
    return line


def format_calendar_density(ctx: InstructionContext) -> str:
    cd = ctx.calendar_density
    if cd is None:
        return ""
    if cd.today.count == 0 and cd.tomorrow.count == 0:
        return ""
    today_header = _format_day(cd.today, is_tomorrow=False)
    tomorrow_header = _format_day(
        cd.tomorrow, is_tomorrow=True, heavy=cd.tomorrow.count >= _HEAVY_DAY_THRESHOLD
    )
    lines: list[str] = [
        "CALENDAR (pre-fetched — reference today's schedule directly without calling "
        "find_workspace; for tomorrow or other days, call find_workspace):",
        f"today: {today_header}",
    ]
    for e in cd.today.events:
        lines.append(f"  {_format_event_line(e)}")
    if len(cd.today.events) < cd.today.count:
        more = cd.today.count - len(cd.today.events)
        lines.append(f"  …and {more} more (find_workspace to see them)")
    lines.append(f"tomorrow: {tomorrow_header}")
    return "\n".join(lines)


def _build_practice_ctx(ctx: InstructionContext) -> Any:
    """Return a `f(practice) → PracticeCtx` builder closing over `ctx`."""

    def builder(p: Practice) -> PracticeCtx:
        return PracticeCtx(base=ctx, practice_state=practice_state_for(ctx.user_profile, p.id))

    return builder


def format_enabled_practices(ctx: InstructionContext) -> list[str]:
    p_ctx = _build_practice_ctx(ctx)
    out: list[str] = []
    for p in get_enabled_practices(ctx.user_profile):
        if p.directive is None:
            continue
        result = p.directive(p_ctx(p))
        out.append(result or "")
    return out


def format_available_practices(ctx: InstructionContext) -> str:
    disabled = [p for p in get_disabled_practices(ctx.user_profile) if p.offer_hint]
    if not disabled:
        return ""
    lines = "\n".join(f"- {p.label}: {p.offer_hint}" for p in disabled)
    return f"""AVAILABLE_PRACTICES (not yet enabled):
{lines}

If a moment naturally fits one of these, ask the user (single-choice yes/no via ask_single_choice_question) whether they'd like to enable it. On "yes", call update_user_profile with path="practices.<id>.enabled" value="true" and continue normally. Don't pitch unprompted; once per session at most."""


def format_session_summaries(ctx: InstructionContext) -> list[str]:
    """Continuity blocks — what the agent should remember about the user's
    recent days. Issue #10's design: the user's day-rhythm UX hides chat
    history from them, but the agent still needs continuity to be a coach
    rather than a chatbot."""
    out: list[str] = []
    if ctx.yesterday_summary:
        out.append(f"YESTERDAY: {ctx.yesterday_summary}")
    if ctx.week_summary:
        out.append(f"WEEK:\n{ctx.week_summary}")
    return out


def format_day_phase(ctx: InstructionContext) -> str:
    """Pull the local hour and YYYY-MM-DD from one tz computation so the
    boundaries match what `format_time` shows the agent and what the web
    app uses to mint the per-day sessionId."""
    from zoneinfo import ZoneInfo

    tz = ctx.timezone or "UTC"
    now = ctx.now if ctx.now.tzinfo else ctx.now.replace(tzinfo=ZoneInfo("UTC"))
    local = now.astimezone(ZoneInfo(tz))
    today_local = local.strftime("%Y-%m-%d")
    local_hour = local.hour
    lunch_eaten = _read_lunch_eaten(ctx.user_profile, today_local)
    machine = DailyFlowMachine.from_input(
        DailyFlowInput(
            local_hour=local_hour,
            has_interacted_today=ctx.has_interacted_today,
            lunch_eaten=lunch_eaten,
        )
    )
    p = machine.policy()
    return f"DAY_PHASE: {p.state}\n{p.directive}"


def _read_lunch_eaten(profile: UserProfile | None, date_local: str) -> bool:
    if not profile:
        return False
    daily = profile.get("daily")
    if not isinstance(daily, dict):
        return False
    day = daily.get(date_local)
    if not isinstance(day, dict):
        return False
    return day.get("lunch_eaten") is True


def format_recent_goals(ctx: InstructionContext) -> str:
    if not ctx.recent_goal_updates:
        return ""
    lines: list[str] = []
    for g in ctx.recent_goal_updates:
        note = f" — {g.note}" if g.note else ""
        lines.append(f"  [{g.timestamp}] {g.goal}: {g.status}{note}")
    body = "\n".join(lines)
    return f"RECENT_GOAL_UPDATES (last {len(ctx.recent_goal_updates)}, oldest → newest):\n{body}"


# --- Final assembly -------------------------------------------------------


def build_instruction(ctx: InstructionContext) -> str:
    directive = policy_for(ctx.user_state).directive
    blocks: list[str] = [
        PERSONA_HEADER,
        STYLE_RULES,
        format_info_capture(ctx),
        format_post_tool_reflection(ctx),
        format_examples(ctx),
        f"USER_STATE: {ctx.user_state}",
        f"STATE_DIRECTIVE: {directive}",
        # Funnel-driven nudges. UsageStateMachine computes the right nudge
        # intensity server-side from (userState, chatCount, tier).
        # `_nudge_directive_for` maps the mode → directive text; the
        # THROTTLED_NOTICE rides on top of signup_hard when we've actually
        # downgraded to flash-lite. `format_usage_credits` emits a truthful
        # "turn N of M" block for the hard / throttled / pro_hard states.
        _nudge_directive_for(ctx.nudge_mode),
        THROTTLED_NOTICE_DIRECTIVE if ctx.usage_state == "free_throttled" else "",
        format_usage_credits(ctx),
        # Workspace cheat-sheet only appears when the user has actually
        # connected Workspace.
        WORKSPACE_CHEATSHEET if ctx.user_state == "workspace_connected" else "",
        # Notion cheat-sheet — orthogonal to UserState. Gated solely on
        # the capability flag so a user who is e.g. `email_verified +
        # notion_connected` (no Google link) still gets the directive.
        NOTION_CHEATSHEET if ctx.notion_connected else "",
        # One-shot proactive prompt to fire show_capabilities() — set
        # for the first signed-in turn when neither integration is
        # connected. server.py clears the trigger flag on userMeta
        # after the call observably fires so we don't re-fire.
        CAPABILITIES_PICKER_HINT if ctx.show_capabilities_proactively else "",
        format_time(ctx),
        *format_session_summaries(ctx),
        format_day_phase(ctx),
        format_location(ctx),
        format_weather(ctx),
        format_air_quality(ctx),
        format_holidays(ctx),
        format_nearby_places(ctx),
        format_calendar_density(ctx),
        format_profile(ctx),
        format_recent_goals(ctx),
        format_memories(ctx),
        # Practices: enabled ones inject their own per-turn directive (some
        # skip via null, e.g. evening_gratitude outside its window). Disabled
        # ones surface a single combined "available" hint.
        *format_enabled_practices(ctx),
        format_available_practices(ctx),
    ]
    return "\n\n".join(b for b in blocks if b)
