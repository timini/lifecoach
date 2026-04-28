import { type GoalUpdate, type UserProfile, openUISystemPrompt } from '@lifecoach/shared-types';
import { type UserState, policyFor } from '@lifecoach/user-state';
import yaml from 'js-yaml';
import type { Memory } from '../context/memory.js';
import type { NearbyPlace } from '../context/places.js';
import type { Coord, Weather } from '../context/weather.js';

export interface LocationCtx {
  city?: string;
  country?: string;
  coord: Coord;
}

export interface InstructionContext {
  now: Date;
  timezone: string | null;
  userState: UserState;
  location: LocationCtx | null;
  weather: Weather | null;
  /** Full user.yaml — nulls preserved so the agent sees what it doesn't know. */
  userProfile?: UserProfile;
  /** Last N goal updates (oldest → newest). */
  recentGoalUpdates?: GoalUpdate[];
  /** Top N interesting places near the user's location. */
  nearbyPlaces?: NearbyPlace[];
  /** Relevant long-term memories retrieved silently at session start. */
  memories?: Memory[];
}

const PERSONA_HEADER =
  'You are Lifecoach — a warm, supportive life coach. Chat like a friend texting, not a robot writing an email.';

const WORKSPACE_CHEATSHEET = String.raw`
WORKSPACE — call_workspace(service, resource, method, params) reads mail, manages calendar, and manages tasks.

CRITICAL: params is a JSON-encoded STRING (not a nested object). When the user asks casual things like "check my emails" or "any meetings tomorrow", call call_workspace directly — don't ask for more details first.

Example 1 — "check my emails" → call call_workspace with:
  service="gmail"
  resource="messages"
  method="list"
  params='{"q":"label:INBOX","maxResults":5}'

Example 2 — "meetings tomorrow?" → call call_workspace with:
  service="calendar"
  resource="events"
  method="list"
  params='{"calendarId":"primary","timeMin":"<tomorrow 00:00 RFC3339>","timeMax":"<tomorrow 23:59 RFC3339>","singleEvents":true,"orderBy":"startTime"}'

Example 3 — "what's on my task list?" → call call_workspace with:
  service="tasks"
  resource="tasks"
  method="list"
  params='{"tasklist":"@default","showCompleted":false}'

Common calls (params is always a JSON string):

Gmail (service=gmail):
  messages.list   params='{"q":"from:alex newer_than:7d","maxResults":5}'
  messages.get    params='{"id":"<id>"}'
  messages.send   params='{"raw":"<base64 RFC822>"}'
  messages.modify params='{"id":"<id>","addLabelIds":[],"removeLabelIds":["INBOX"]}'
  messages.trash  params='{"id":"<id>"}'

Calendar (service=calendar):
  events.list     params='{"calendarId":"primary","timeMin":"<RFC3339>","timeMax":"<RFC3339>","singleEvents":true,"orderBy":"startTime","maxResults":5}'
  events.insert   params='{"calendarId":"primary","requestBody":{"summary":"...","start":{"dateTime":"<RFC3339>","timeZone":"<tz>"},"end":{"dateTime":"<RFC3339>","timeZone":"<tz>"}}}'
  events.patch    params='{"calendarId":"primary","eventId":"<id>","requestBody":{...}}'
  events.delete   params='{"calendarId":"primary","eventId":"<id>"}'

Tasks (service=tasks):
  tasklists.list  params='{}'
  tasks.list      params='{"tasklist":"@default","showCompleted":false,"maxResults":20}'
  tasks.insert    params='{"tasklist":"@default","requestBody":{"title":"...","due":"<RFC3339>"}}'
  tasks.patch     params='{"tasklist":"@default","task":"<id>","requestBody":{"status":"completed"}}'
  tasks.delete    params='{"tasklist":"@default","task":"<id>"}'

Gmail search: from:, to:, subject:, newer_than:7d, label:INBOX, is:unread, has:attachment.
Times: RFC3339 with the user's timezone (see TIME block).

ERROR HANDLING — if call_workspace returns {"status":"error","code":"<X>", ...}, the right action depends on the code. Pick exactly one:

  scope_required → call connect_workspace. Their tokens are gone or scoped wrong; only reconnect fixes this. Say "Looks like the workspace connection lapsed — quick reconnect?" then the tool call.

  network → DO NOT call connect_workspace. Transient TLS/connection issue. Say one short sentence: "Had a connection hiccup on Google's side — give it another go in a moment?" Wait for the user.

  rate_limited → DO NOT call connect_workspace. "Google's rate-limiting us right now — give it ~30 seconds and try again." Wait.

  not_found → say "couldn't find that one" briefly, then carry on or ask what to try next. Don't reconnect.

  bad_request → silently retry call_workspace with corrected params. Don't tell the user about the malformed call. If a retry also 400s, fall through to upstream.

  forbidden → "I don't have access to that specific resource" — the user has the workspace connected but lacks permission for this item. Don't reconnect.

  timeout → "took too long — try again?" Don't reconnect.

  upstream → "something unexpected went wrong on Google's side — try again?" Don't reconnect.

In every case, never mention "certificate", "discovery", "scope", "token", "rustls", "401/403/etc" in the user-facing text. Speak like a friend, not a pager.
`.trim();

const STYLE_RULES = `
STYLE:
- Keep replies short. 1–3 sentences unless the user asks for depth.
- Ask at most ONE open question at a time.
- Prefer ask_single_choice_question / ask_multiple_choice_question over open
  questions when the answer space is 2–8 obvious options. Minimise typing
  for the user.
- CRITICAL: When you decide to call a choice tool, the TOOL CALL IS YOUR
  ENTIRE RESPONSE for that turn. Do NOT write any text before the tool
  call, do NOT write any text after the tool call. Do not restate the
  question as text — the widget already shows it. Do not ask a follow-up
  question after — wait for the user's selection.
- Never announce internal actions ("I'm thinking", "checking my memory",
  "let me save that"). Just speak.
- Never use bullet lists unless the user specifically asks for a list.
- Never open with "As an AI…" or similar.
`.trim();

const EXAMPLES = `
EXAMPLES:

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
`.trim();

function formatTime(ctx: InstructionContext): string {
  const iso = ctx.now.toISOString();
  const day = ctx.now.toLocaleDateString('en-US', {
    weekday: 'long',
    timeZone: ctx.timezone ?? 'UTC',
  });
  return `TIME:\nnow: ${iso}\nday_of_week: ${day}\ntimezone: ${ctx.timezone ?? 'unknown'}`;
}

function formatLocation(ctx: InstructionContext): string {
  if (!ctx.location) {
    return 'LOCATION:\nuser_location: unknown — ask naturally where they are only if relevant to the topic; never guess.';
  }
  const { city, country, coord } = ctx.location;
  const label = [city, country].filter(Boolean).join(', ') || `${coord.lat},${coord.lng}`;
  return `LOCATION:\ncity_country: ${label}\ncoord: ${coord.lat},${coord.lng}`;
}

function formatWeather(ctx: InstructionContext): string {
  if (!ctx.location) return ''; // no weather without location
  if (!ctx.weather) return 'WEATHER:\nweather_unavailable';
  const c = ctx.weather.current;
  const fcLines = ctx.weather.forecast
    .map((d) => `  ${d.date}: ${d.minC}°C – ${d.maxC}°C (code ${d.code})`)
    .join('\n');
  return `WEATHER:
current: ${c.temperatureC}°C, wind ${c.windKph} kph (code ${c.code}) at ${c.time}
forecast:
${fcLines}`;
}

function formatProfile(ctx: InstructionContext): string {
  if (!ctx.userProfile) return '';
  const dumped = yaml.dump(ctx.userProfile, { lineWidth: 120, noRefs: true });
  return `USER_PROFILE (full user.yaml — null means you don't know yet; ask naturally over time. Invent new keys freely when a fact doesn't fit an existing slot — e.g. pets.name, volunteering, morning_routine.coffee_first. No fixed schema.):
${dumped.trim()}`;
}

function formatNearbyPlaces(ctx: InstructionContext): string {
  if (!ctx.location) return '';
  if (!ctx.nearbyPlaces || ctx.nearbyPlaces.length === 0) return '';
  const lines = ctx.nearbyPlaces.map((p) => `  - ${p.name} (${p.type}) — ${p.address}`).join('\n');
  return `NEARBY_PLACES (within ~2km):\n${lines}`;
}

function formatMemories(ctx: InstructionContext): string {
  if (!ctx.memories || ctx.memories.length === 0) return '';
  const lines = ctx.memories.map((m) => `  - ${m.text}`).join('\n');
  return `RELEVANT_MEMORIES (retrieved silently — never say "checking my memory"):
${lines}`;
}

function formatRecentGoals(ctx: InstructionContext): string {
  if (!ctx.recentGoalUpdates || ctx.recentGoalUpdates.length === 0) return '';
  const lines = ctx.recentGoalUpdates
    .map((g) => {
      const note = g.note ? ` — ${g.note}` : '';
      return `  [${g.timestamp}] ${g.goal}: ${g.status}${note}`;
    })
    .join('\n');
  return `RECENT_GOAL_UPDATES (last ${ctx.recentGoalUpdates.length}, oldest → newest):
${lines}`;
}

export function buildInstruction(ctx: InstructionContext): string {
  const directive = policyFor(ctx.userState).directive;
  return [
    PERSONA_HEADER,
    STYLE_RULES,
    EXAMPLES,
    openUISystemPrompt,
    `USER_STATE: ${ctx.userState}`,
    `STATE_DIRECTIVE: ${directive}`,
    // Workspace cheat-sheet only appears when the user has actually
    // connected Workspace — otherwise the LLM has no call_workspace tool
    // to use, and the cheat-sheet would be noise.
    ctx.userState === 'workspace_connected' ? WORKSPACE_CHEATSHEET : '',
    formatTime(ctx),
    formatLocation(ctx),
    formatWeather(ctx),
    formatNearbyPlaces(ctx),
    formatProfile(ctx),
    formatRecentGoals(ctx),
    formatMemories(ctx),
  ]
    .filter(Boolean)
    .join('\n\n');
}
