"""Day-planning practice.

Mirrors `apps/agent/src/practices/dayPlanning.ts`. Time gate 05:00–10:59
local, idempotent via `practices.day_planning.last_planned_date`. Two
arms (light vs Workspace-connected). No tools — the model uses the
existing main-agent + workspace-agent tool surface.
"""

from __future__ import annotations

from lifecoach_agent.practices.day_clock import local_date_and_hour
from lifecoach_agent.practices.types import Practice, PracticeCtx

ID = "day_planning"
LAST_PLANNED_PATH = f"practices.{ID}.last_planned_date"
MORNING_START_HOUR = 5
MORNING_END_HOUR = 10  # inclusive — 11:00 onwards skips


def directive(ctx: PracticeCtx) -> str | None:
    today, hour = local_date_and_hour(ctx.base.now, ctx.base.timezone)
    if hour < MORNING_START_HOUR or hour > MORNING_END_HOUR:
        return None
    last_planned = ctx.practice_state.get("last_planned_date")
    if isinstance(last_planned, str) and last_planned == today:
        return None

    workspace_connected = ctx.base.user_state == "workspace_connected"
    stamp_line = f'update_user_profile({{ path: "{LAST_PLANNED_PATH}", value: "{today}" }})'
    arm = _WORKSPACE_ARM if workspace_connected else _LIGHT_ARM
    return f"""DAY_PLANNING (practice on, morning window, not yet done today):

The user just shared how they're feeling. Now help them plan.

Pivot naturally — one short transition line, then a question. Don't list-bomb.{arm}

After the user lands on their priorities for the day, stamp this practice as
done so we don't re-run today:
  {stamp_line}
Do this silently — never announce the save."""


def examples(ctx: PracticeCtx) -> str | None:
    """Workspace arm when connected, light arm otherwise. The directive
    enforces the time/idempotency gate; examples don't — they're only
    injected when the practice is enabled."""
    if ctx.base.user_state == "workspace_connected":
        return _WORKSPACE_EXAMPLE
    return _LIGHT_EXAMPLE


_LIGHT_ARM = """
[Without Workspace connected]
Aim for 1–3 priorities. Two soft questions max:
  1. "What's the most important thing today?"
  2. "Anything you need to protect time for?"
Land on a tight summary. If they name a goal worth tracking, call log_goal_update.
If you learn a recurring fact (anniversary, weekly commitment, kid's school day),
call update_user_profile."""


_WORKSPACE_ARM = """
[With Workspace connected]
Quietly fetch today's inbox before the question:
  call_workspace(service:"gmail", resource:"users.messages", method:"list",
                 params:'{"userId":"me","q":"newer_than:1d label:INBOX","maxResults":15}')
Then for each interesting one, users.messages.get to read body+subject.

Cross-reference what's already in this prompt's profile, recent_goals, and
yesterday's summary BEFORE classifying. An email about "Maya's parents'
evening" matters more if Maya is in the profile.

Categorise EVERY message into one of:
  - **Noise**: newsletters, automated reports, no-action — collect IDs
  - **Action**: user has to do something — surface as a 1-line task
  - **Event**: meeting/appointment with date+time — propose calendar add
  - **Information**: touches a known goal/profile fact — mention briefly

Ask ONCE before archiving the noise bucket:
  ask_single_choice_question({
    question: "Archive these N? <2-3 subjects, … rest>",
    options: ["Yes, archive", "Skip"]
  })
On "Yes, archive": for each id, users.messages.modify({removeLabelIds:["INBOX"]}).
NEVER trash. Archive means modify-remove-INBOX (already in WORKSPACE_CHEATSHEET).

Ask ONCE per inferred event:
  ask_single_choice_question({
    question: "Add 'Tue lunch with Sarah, 12:30' to your calendar?",
    options: ["Yes", "Skip"]
  })
On "Yes": calendar.events.insert with the inferred start+end.

Surface 1–3 actions or tasks (not all of them). Tie them to the user's
goals/priority for today if you can."""


_LIGHT_EXAMPLE = """
GOOD (DAY_PLANNING, no Workspace — pivot from wellness check-in into a tight 1–3 priority plan):
User: "Slept ok, feeling alright. Coffee in hand."
Assistant: "Glad the engine started. While we're here — what's the most important thing today?"
User: "Finish the report draft. Pick the kids up at 4."
Assistant: [calls update_user_profile path="practices.day_planning.last_planned_date" value="2026-05-06"]
"Right — report draft as the big rock, school run at 4 as the immovable. Anything between those two you need to protect time for, or is the rest flex?"
""".strip()


_WORKSPACE_EXAMPLE = """
GOOD (DAY_PLANNING with Workspace — quiet inbox pull, batched archive confirmation, then surface 2 tasks):
User: "Morning. Coffee in. Ready when you are."
Assistant: [calls call_workspace service="gmail" resource="users.messages" method="list" params='{"userId":"me","q":"newer_than:1d label:INBOX","maxResults":15}']
[reads top messages with users.messages.get]
"Six newsletters and three things worth a look this morning."
[calls ask_single_choice_question question="Archive these 6? Substack digest, LinkedIn weekly, two newsletters from your kids' schools (just FYI), Strava recap, AWS billing alert. (Note — the school ones look auto, no actions in either.)" options=["Yes, archive", "Skip"]]
User: "Yes, archive"
Assistant: [calls call_workspace service="gmail" resource="users.messages" method="modify" params='{"userId":"me","id":"<id1>","requestBody":{"removeLabelIds":["INBOX"]}}'] (× 6)
"Done. Real things: Maya's parent-teacher meeting got bumped to Tuesday 6pm, and there's a contractor invoice waiting on you."
[calls ask_single_choice_question question="Add 'Maya parent-teacher, Tue 6pm' to your calendar?" options=["Yes", "Skip"]]
User: "Yes"
Assistant: [calls call_workspace service="calendar" resource="events" method="insert" params='{"calendarId":"primary","requestBody":{"summary":"Maya parent-teacher","start":{"dateTime":"2026-05-12T18:00:00+01:00"},"end":{"dateTime":"2026-05-12T18:30:00+01:00"}}}']
[calls update_user_profile path="practices.day_planning.last_planned_date" value="2026-05-06"]
"Booked. So the day has the parent-teacher locked in for Tuesday and the invoice as today's only must-do — what's the report situation, still on the morning side or has it slid?"
""".strip()


day_planning = Practice(
    id=ID,
    label="Plan the day",
    description=(
        "After the morning check-in, the coach helps you sort 1–3 priorities — and "
        "pulls inbox + calendar signal when Workspace is connected."
    ),
    offer_hint=(
        "If the user mentions starting their day, feeling overwhelmed by their inbox, "
        'or asks "what should I focus on", consider offering Plan the day.'
    ),
    directive=directive,
    examples=examples,
)
