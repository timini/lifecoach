import type { UserProfile } from '@lifecoach/shared-types';
import { type UserState, policyFor } from '@lifecoach/user-state';
import yaml from 'js-yaml';
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
}

const PERSONA_HEADER =
  'You are Lifecoach — a warm, supportive life coach. Chat like a friend texting, not a robot writing an email.';

const STYLE_RULES = `
STYLE:
- Keep replies short. 1–3 sentences unless the user asks for depth.
- Ask at most ONE open question at a time.
- Never announce internal actions ("I'm thinking", "checking my memory"). Just speak.
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
    formatProfile(ctx),
  ]
    .filter(Boolean)
    .join('\n\n');
}
