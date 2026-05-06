/**
 * Day-planning practice.
 *
 * When ON, after the wellness/emotional check-in finishes, the coach
 * pivots to help the user plan the day. Two arms:
 *
 *   - **Without Workspace** — short conversation, one or two soft
 *     questions, land on 1–3 priorities.
 *   - **With Workspace** (`userState === 'workspace_connected'`) — also
 *     pull today's inbox, classify into noise/action/event/information,
 *     ask once before archiving the noise bucket, ask once per inferred
 *     event before adding it to the calendar, surface 1–3 tasks tied to
 *     the user's goals.
 *
 * Time gate: 05:00–10:59 local (one hour wider than DailyFlowMachine's
 * morning window so a slightly-late riser still gets the prompt).
 *
 * Idempotency: stamps `practices.day_planning.last_planned_date` once
 * the user lands on priorities. Subsequent same-day turns skip the
 * directive — we don't want to re-pull email mid-conversation.
 */

import { localDateAndHour } from './dayClock.js';
import type { Practice, PracticeCtx } from './types.js';

const ID = 'day_planning';
const LAST_PLANNED_PATH = `practices.${ID}.last_planned_date`;
const MORNING_START_HOUR = 5;
const MORNING_END_HOUR = 10; // inclusive — 11:00 onwards skips

function directive(ctx: PracticeCtx): string | null {
  const { date: today, hour } = localDateAndHour(ctx.now, ctx.timezone);
  if (hour < MORNING_START_HOUR || hour > MORNING_END_HOUR) return null;
  const lastPlanned =
    typeof ctx.practiceState.last_planned_date === 'string'
      ? (ctx.practiceState.last_planned_date as string)
      : null;
  if (lastPlanned === today) return null;

  const workspaceConnected = ctx.userState === 'workspace_connected';
  const stampLine = `update_user_profile({ path: "${LAST_PLANNED_PATH}", value: "${today}" })`;

  const lightArm = `\n[Without Workspace connected]
Aim for 1–3 priorities. Two soft questions max:
  1. "What's the most important thing today?"
  2. "Anything you need to protect time for?"
Land on a tight summary. If they name a goal worth tracking, call log_goal_update.
If you learn a recurring fact (anniversary, weekly commitment, kid's school day),
call update_user_profile.`;

  const workspaceArm = `\n[With Workspace connected]
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
goals/priority for today if you can.`;

  return `DAY_PLANNING (practice on, morning window, not yet done today):

The user just shared how they're feeling. Now help them plan.

Pivot naturally — one short transition line, then a question. Don't list-bomb.${
    workspaceConnected ? workspaceArm : lightArm
  }

After the user lands on their priorities for the day, stamp this practice as
done so we don't re-run today:
  ${stampLine}
Do this silently — never announce the save.`;
}

/**
 * Few-shot examples for EXAMPLES. Returns the workspace arm when the
 * user has Workspace connected, the light arm otherwise. The directive
 * itself enforces the time/idempotency gate; examples don't need to —
 * they're only injected when buildInstruction iterates enabled
 * practices, which already implies the user has the practice on.
 */
function examples(ctx: PracticeCtx): string | null {
  if (ctx.userState === 'workspace_connected') {
    return WORKSPACE_EXAMPLE;
  }
  return LIGHT_EXAMPLE;
}

const LIGHT_EXAMPLE = `
GOOD (DAY_PLANNING, no Workspace — pivot from wellness check-in into a tight 1–3 priority plan):
User: "Slept ok, feeling alright. Coffee in hand."
Assistant: "Glad the engine started. While we're here — what's the most important thing today?"
User: "Finish the report draft. Pick the kids up at 4."
Assistant: [calls update_user_profile path="practices.day_planning.last_planned_date" value="2026-05-06"]
"Right — report draft as the big rock, school run at 4 as the immovable. Anything between those two you need to protect time for, or is the rest flex?"
`.trim();

const WORKSPACE_EXAMPLE = `
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
`.trim();

export const dayPlanning: Practice = {
  id: ID,
  label: 'Plan the day',
  description:
    'After the morning check-in, the coach helps you sort 1–3 priorities — and pulls inbox + calendar signal when Workspace is connected.',
  offerHint:
    'If the user mentions starting their day, feeling overwhelmed by their inbox, or asks "what should I focus on", consider offering Plan the day.',
  directive,
  examples,
};
