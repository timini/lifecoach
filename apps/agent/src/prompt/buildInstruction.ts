import type { GoalUpdate, UserProfile } from '@lifecoach/shared-types';
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

const STYLE_RULES = `
STYLE:
- Keep replies short. 1–3 sentences unless the user asks for depth.
- Ask at most ONE open question at a time.
- Prefer ask_single_choice_question / ask_multiple_choice_question over open
  questions when the answer space is 2–8 obvious options. Minimise typing
  for the user. When you call one, write NO additional text that turn.
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
  return `USER_PROFILE (full user.yaml — null means you don't know yet; ask naturally over time):
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
    `USER_STATE: ${ctx.userState}`,
    `STATE_DIRECTIVE: ${directive}`,
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
