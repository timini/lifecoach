import { describe, expect, it } from 'vitest';
import { type InstructionContext, buildInstruction } from './buildInstruction.js';

const BASE: InstructionContext = {
  now: new Date('2026-04-21T09:00:00Z'),
  timezone: 'Australia/Melbourne',
  userState: 'anonymous',
  location: null,
  weather: null,
};

describe('buildInstruction', () => {
  it('renders yesterday and week summary blocks when present', () => {
    const s = buildInstruction({
      ...BASE,
      yesterdaySummary: 'Yesterday was heavy but productive.',
      weekSummary: 'This week showed better consistency and sleep.',
    });
    expect(s).toMatch(/YESTERDAY: Yesterday was heavy but productive\./);
    expect(s).toMatch(/WEEK: This week showed better consistency and sleep\./);
  });

  it('omits yesterday and week summary blocks when missing', () => {
    const s = buildInstruction(BASE);
    expect(s).not.toMatch(/YESTERDAY:/);
    expect(s).not.toMatch(/WEEK:/);
  });

  it('always includes the persona block', () => {
    const s = buildInstruction(BASE);
    expect(s).toMatch(/emotionally intelligent coaching guide/i);
  });

  it('lists not-yet-enabled practices in AVAILABLE_PRACTICES (so the agent can offer)', () => {
    // Default fixture has no practices.* in profile → all practices disabled.
    const s = buildInstruction({ ...BASE, userProfile: {} });
    expect(s).toMatch(/AVAILABLE_PRACTICES/);
    expect(s).toMatch(/Evening gratitude/);
    expect(s).toMatch(/Journaling/);
    expect(s).toMatch(/ask_single_choice_question/);
    expect(s).toMatch(/practices\.<id>\.enabled/);
  });

  it('injects an enabled practice directive (journaling, no time gate)', () => {
    const s = buildInstruction({
      ...BASE,
      userProfile: { practices: { journaling: { enabled: true } } },
    });
    expect(s).toMatch(/JOURNALING \(practice on\)/);
    expect(s).toMatch(/journal_entry/);
    // And it should drop journaling from AVAILABLE_PRACTICES (still lists evening_gratitude).
    expect(s).toMatch(/AVAILABLE_PRACTICES/);
    const available = s.split('AVAILABLE_PRACTICES')[1] ?? '';
    expect(available).not.toMatch(/Journaling/);
    expect(available).toMatch(/Evening gratitude/);
  });

  it('omits AVAILABLE_PRACTICES when every practice is enabled', () => {
    const s = buildInstruction({
      ...BASE,
      userProfile: {
        practices: {
          evening_gratitude: { enabled: true },
          journaling: { enabled: true },
        },
      },
    });
    expect(s).not.toMatch(/AVAILABLE_PRACTICES/);
  });

  it('always includes the INFO_CAPTURE directive (proactive fact-capture rules)', () => {
    const s = buildInstruction(BASE);
    expect(s).toMatch(/INFO_CAPTURE/);
    // Spot-check that the directive enumerates the categories that were
    // previously missed (names of family members in particular).
    expect(s).toMatch(/Names of people in their life/i);
    expect(s).toMatch(/update_user_profile/);
    expect(s).toMatch(/memory_save/);
    // And demonstrates the right behaviour through at least one example.
    expect(s).toMatch(/Maya/);
  });

  it('always includes the current date/time', () => {
    const s = buildInstruction(BASE);
    expect(s).toMatch(/2026-04-21/);
  });

  it('renders TIME pre-converted to the user timezone (no UTC→local math for the agent)', () => {
    // 2026-04-21T09:00:00Z → 7:00 PM Melbourne (AEST, UTC+10).
    const s = buildInstruction(BASE);
    expect(s).toMatch(/now_local:.*7:00\s*PM/);
    expect(s).toMatch(/Australia\/Melbourne/);
    // UTC stays alongside as a sanity reference.
    expect(s).toMatch(/now_utc: 2026-04-21T09:00:00\.000Z/);
  });

  it('anchors the agent against inventing/echoing a stale time', () => {
    // The block must explicitly forbid guessing or echoing an earlier
    // turn's time, AND tell the model to compare against now_local before
    // claiming an event is "starting now". This is the safeguard against
    // Flash hallucinating "It's 12:51 PM" when the prompt says 12:40.
    const s = buildInstruction(BASE);
    expect(s).toMatch(/single source of truth/i);
    expect(s).toMatch(/never (infer|guess)/i);
    expect(s).toMatch(/starting now/i);
  });

  it('includes the state-specific directive', () => {
    const s = buildInstruction(BASE);
    expect(s).toMatch(/anonymous/i);
    expect(s).toMatch(/saving progress/i);
  });

  it('does NOT hallucinate a city when location is null (no IP fallback)', () => {
    const s = buildInstruction({ ...BASE, location: null, timezone: null });
    // Must explicitly flag location as unknown and tell the coach to not guess.
    expect(s).toMatch(/user_location: unknown/);
    expect(s).not.toMatch(/Melbourne|Sydney|New York|London/);
    // Weather block must also be absent — no location, no weather.
    expect(s).not.toMatch(/WEATHER:/);
  });

  it('includes location and weather when both are present', () => {
    const s = buildInstruction({
      ...BASE,
      location: { city: 'Melbourne', country: 'AU', coord: { lat: -37.81, lng: 144.96 } },
      weather: {
        current: { temperatureC: 18.5, windKph: 12, code: 2, time: '2026-04-21T09:00' },
        forecast: [
          { date: '2026-04-21', maxC: 22, minC: 12, code: 2 },
          { date: '2026-04-22', maxC: 20, minC: 11, code: 3 },
        ],
        today: {
          sunrise: '2026-04-21T06:32',
          sunset: '2026-04-21T18:14',
          daylightHours: 11.7,
          uvIndexMax: 7.2,
          rainChancePeak: { hour: '2026-04-21T15:00', probability: 60 },
        },
      },
    });
    expect(s).toMatch(/Melbourne/);
    expect(s).toMatch(/18\.5/);
    expect(s).toMatch(/forecast/i);
  });

  it('renders a WEATHER_TODAY block with sunrise, sunset, UV (when high), and rain peak', () => {
    const s = buildInstruction({
      ...BASE,
      location: { city: 'Melbourne', country: 'AU', coord: { lat: -37.81, lng: 144.96 } },
      weather: {
        current: { temperatureC: 18.5, windKph: 12, code: 2, time: '2026-04-21T09:00' },
        forecast: [{ date: '2026-04-21', maxC: 22, minC: 12, code: 2 }],
        today: {
          sunrise: '2026-04-21T06:32',
          sunset: '2026-04-21T18:14',
          daylightHours: 11.7,
          uvIndexMax: 7.2,
          rainChancePeak: { hour: '2026-04-21T15:00', probability: 60 },
        },
      },
    });
    expect(s).toMatch(/WEATHER_TODAY:/);
    expect(s).toMatch(/06:32 → 18:14/);
    expect(s).toMatch(/11\.7h/);
    expect(s).toMatch(/UV peak: 7\.2/);
    expect(s).toMatch(/rain: 60% likely around 15:00/);
  });

  it('omits the rain line when no peak; omits the UV line when UV is low', () => {
    const s = buildInstruction({
      ...BASE,
      location: { city: 'Melbourne', country: 'AU', coord: { lat: -37.81, lng: 144.96 } },
      weather: {
        current: { temperatureC: 12, windKph: 5, code: 1, time: '2026-04-21T09:00' },
        forecast: [{ date: '2026-04-21', maxC: 14, minC: 8, code: 1 }],
        today: {
          sunrise: '2026-04-21T07:00',
          sunset: '2026-04-21T17:30',
          daylightHours: 10.5,
          uvIndexMax: 3,
          rainChancePeak: null,
        },
      },
    });
    expect(s).toMatch(/WEATHER_TODAY:/);
    expect(s).not.toMatch(/UV peak/);
    expect(s).not.toMatch(/rain:/);
  });

  it('renders the AIR_QUALITY block when AQI is moderate or worse', () => {
    const s = buildInstruction({
      ...BASE,
      location: { city: 'Melbourne', country: 'AU', coord: { lat: -37.81, lng: 144.96 } },
      airQuality: {
        aqi: 85,
        pm2_5: 35,
        pm10: 50,
        ozone: 80,
        pollen: { alder: 0.2, grass: 0.5, ragweed: 0.1 },
      },
    });
    expect(s).toMatch(/AIR_QUALITY:/);
    expect(s).toMatch(/poor.*AQI 85/);
    expect(s).not.toMatch(/pollen elevated/);
  });

  it('renders the AIR_QUALITY block when any pollen is elevated, even if AQI is low', () => {
    const s = buildInstruction({
      ...BASE,
      location: { city: 'Melbourne', country: 'AU', coord: { lat: -37.81, lng: 144.96 } },
      airQuality: {
        aqi: 20,
        pm2_5: 5,
        pm10: 10,
        ozone: 30,
        pollen: { alder: 0.1, grass: 4.1, ragweed: 0.2 },
      },
    });
    expect(s).toMatch(/AIR_QUALITY:/);
    expect(s).toMatch(/pollen elevated:.*grass 4\.1/);
    // AQI is fine — should NOT print the air-quality severity line.
    expect(s).not.toMatch(/AQI 20/);
  });

  it('omits AIR_QUALITY entirely on a clear day (silence-on-clean)', () => {
    const s = buildInstruction({
      ...BASE,
      location: { city: 'Melbourne', country: 'AU', coord: { lat: -37.81, lng: 144.96 } },
      airQuality: {
        aqi: 25,
        pm2_5: 5,
        pm10: 10,
        ozone: 30,
        pollen: { alder: 0.1, grass: 0.2, ragweed: 0.1 },
      },
    });
    expect(s).not.toMatch(/AIR_QUALITY/);
  });

  it('renders the HOLIDAYS block when at least one falls in the next 7 days', () => {
    const s = buildInstruction({
      ...BASE,
      holidays: [{ date: '2026-05-04', localName: 'Early May Bank Holiday', countryCode: 'GB' }],
    });
    expect(s).toMatch(/HOLIDAYS \(next 7 days/);
    expect(s).toMatch(/2026-05-04: Early May Bank Holiday \(GB\)/);
  });

  it('omits HOLIDAYS when the list is empty', () => {
    const s = buildInstruction({ ...BASE, holidays: [] });
    expect(s).not.toMatch(/HOLIDAYS/);
  });

  it('renders CALENDAR with today events listed inline; tomorrow stays a summary', () => {
    const s = buildInstruction({
      ...BASE,
      calendarDensity: {
        today: {
          count: 3,
          firstStart: '10:00',
          lastEnd: '17:30',
          nextStart: '14:00',
          events: [
            { summary: 'Standup', start: '10:00', end: '10:30', allDay: false },
            { summary: 'Lunch with Alex', start: '13:00', end: '14:00', allDay: false },
            { summary: '1:1', start: '16:00', end: '17:30', allDay: false },
          ],
        },
        tomorrow: { count: 2, firstStart: '09:00', lastEnd: '15:00' },
      },
    });
    expect(s).toMatch(/CALENDAR \(pre-fetched/);
    expect(s).toMatch(/today: 3 events \(next at 14:00, last ends 17:30\)/);
    expect(s).toMatch(/10:00–10:30 {2}Standup/);
    expect(s).toMatch(/13:00–14:00 {2}Lunch with Alex/);
    expect(s).toMatch(/16:00–17:30 {2}1:1/);
    expect(s).toMatch(/tomorrow: 2 events \(first 09:00, last ends 15:00\)/);
    expect(s).not.toMatch(/heavy day/); // 2 events isn't heavy
  });

  it('renders all-day events with "all-day" instead of a time range', () => {
    const s = buildInstruction({
      ...BASE,
      calendarDensity: {
        today: {
          count: 2,
          firstStart: '11:00',
          lastEnd: '12:00',
          nextStart: '11:00',
          events: [
            { summary: 'Birthday', start: null, end: null, allDay: true },
            { summary: 'Standup', start: '11:00', end: '12:00', allDay: false },
          ],
        },
        tomorrow: { count: 0, firstStart: null, lastEnd: null },
      },
    });
    expect(s).toMatch(/all-day/);
    expect(s).toMatch(/Birthday/);
  });

  it('signals truncation when today has more events than the inline list', () => {
    const s = buildInstruction({
      ...BASE,
      calendarDensity: {
        today: {
          count: 12,
          firstStart: '09:00',
          lastEnd: '18:00',
          nextStart: '09:00',
          // Only 10 inline (the cap) — 2 left over.
          events: Array.from({ length: 10 }, (_, i) => ({
            summary: `event-${i}`,
            start: '09:00',
            end: '09:30',
            allDay: false,
          })),
        },
        tomorrow: { count: 0, firstStart: null, lastEnd: null },
      },
    });
    expect(s).toMatch(/…and 2 more \(call_workspace to see them\)/);
  });

  it('flags tomorrow as a heavy day when count >= 7', () => {
    const s = buildInstruction({
      ...BASE,
      calendarDensity: {
        today: {
          count: 1,
          firstStart: '11:00',
          lastEnd: '11:30',
          nextStart: '11:00',
          events: [{ summary: 'Standup', start: '11:00', end: '11:30', allDay: false }],
        },
        tomorrow: { count: 8, firstStart: '09:00', lastEnd: '18:00' },
      },
    });
    expect(s).toMatch(/tomorrow: 8 events.*heavy day/);
  });

  it('omits CALENDAR when both days are empty (silence-on-clear)', () => {
    const s = buildInstruction({
      ...BASE,
      calendarDensity: {
        today: { count: 0, firstStart: null, lastEnd: null, nextStart: null, events: [] },
        tomorrow: { count: 0, firstStart: null, lastEnd: null },
      },
    });
    expect(s).not.toMatch(/CALENDAR/);
  });

  it('omits CALENDAR when null (workspace not connected or fetch failed)', () => {
    const s = buildInstruction({ ...BASE, calendarDensity: null });
    expect(s).not.toMatch(/CALENDAR/);
  });

  it('CALENDAR omits "next at" when all today events are past', () => {
    const s = buildInstruction({
      ...BASE,
      calendarDensity: {
        today: {
          count: 2,
          firstStart: '08:00',
          lastEnd: '12:00',
          nextStart: null,
          events: [
            { summary: 'Early standup', start: '08:00', end: '08:30', allDay: false },
            { summary: 'Coffee', start: '11:30', end: '12:00', allDay: false },
          ],
        },
        tomorrow: { count: 0, firstStart: null, lastEnd: null },
      },
    });
    expect(s).toMatch(/today: 2 events \(last ends 12:00\)/);
    expect(s).toMatch(/tomorrow: no events/);
  });

  it('omits AIR_QUALITY when location is unknown (avoid hallucinating)', () => {
    const s = buildInstruction({
      ...BASE,
      location: null,
      airQuality: {
        aqi: 200,
        pm2_5: 100,
        pm10: 200,
        ozone: 150,
        pollen: { alder: 0, grass: 0, ragweed: 0 },
      },
    });
    expect(s).not.toMatch(/AIR_QUALITY/);
  });

  it('mentions location even if weather is null (e.g., API timed out)', () => {
    const s = buildInstruction({
      ...BASE,
      location: { city: 'Melbourne', country: 'AU', coord: { lat: -37.81, lng: 144.96 } },
      weather: null,
    });
    expect(s).toMatch(/Melbourne/);
    expect(s).toMatch(/weather_unavailable/);
  });

  it('directive changes with user state', () => {
    const anon = buildInstruction({ ...BASE, userState: 'anonymous' });
    const wsc = buildInstruction({ ...BASE, userState: 'workspace_connected' });
    expect(anon).not.toBe(wsc);
    expect(wsc).toMatch(/workspace/i);
  });

  it('static-persona snapshot — keeps the BAD/GOOD examples stable', () => {
    const s = buildInstruction(BASE);
    expect(s).toMatch(/BAD/);
    expect(s).toMatch(/GOOD/);
  });

  it('omits the USER_PROFILE block when no profile is provided', () => {
    const s = buildInstruction(BASE);
    expect(s).not.toMatch(/USER_PROFILE/);
  });

  it('injects recent goal updates when provided', () => {
    const s = buildInstruction({
      ...BASE,
      recentGoalUpdates: [
        { timestamp: '2026-04-20T09:00:00Z', goal: 'Running', status: 'started' },
        {
          timestamp: '2026-04-21T09:00:00Z',
          goal: 'Running',
          status: 'progress',
          note: 'Did 5k this morning',
        },
      ],
    });
    expect(s).toMatch(/RECENT_GOAL_UPDATES/);
    expect(s).toMatch(/Running: progress/);
    expect(s).toMatch(/Did 5k this morning/);
  });

  it('omits RECENT_GOAL_UPDATES when the list is empty', () => {
    const s = buildInstruction({ ...BASE, recentGoalUpdates: [] });
    expect(s).not.toMatch(/RECENT_GOAL_UPDATES/);
  });

  it('injects the full user.yaml with nulls preserved when profile is provided', () => {
    const s = buildInstruction({
      ...BASE,
      userProfile: {
        name: 'Alex',
        age: null,
        location: { address: null },
        family: {
          relationship_status: null,
          partner_name: null,
          children: 'Two kids, ages 8 and 4. Named Maya and Theo.',
          living_situation: null,
        },
        occupation: { title: null, industry: null, work_style: null, satisfaction: null },
        health: { exercise_habits: null, sleep_quality: null },
        personality: { strengths: null, challenges: null, values: null },
        goals: {
          short_term: ['Running', 'Garden Renovation'],
          medium_term: [],
          long_term: [],
          currently_working_on: null,
        },
        preferences: {
          communication_style: null,
          coaching_focus: null,
          session_preference: null,
        },
      },
    });
    expect(s).toMatch(/USER_PROFILE/);
    expect(s).toMatch(/name: Alex/);
    expect(s).toMatch(/Maya and Theo/);
    expect(s).toMatch(/partner_name: null/);
    // The "what you don't know" guidance must be present
    expect(s).toMatch(/null means you don't know yet/);
  });
});

describe('buildInstruction — nudgeMode', () => {
  it('renders no nudge block when nudgeMode is unset', () => {
    const s = buildInstruction(BASE);
    expect(s).not.toMatch(/SIGNUP_NUDGE/);
    expect(s).not.toMatch(/PRO_NUDGE/);
  });

  it('renders only the signup directive for nudgeMode=signup', () => {
    const s = buildInstruction({ ...BASE, nudgeMode: 'signup' });
    expect(s).toMatch(/SIGNUP_NUDGE/);
    expect(s).not.toMatch(/PRO_NUDGE/);
    // Some hint that the nudge is about creating an account / remembering
    expect(s).toMatch(/account|remember/i);
    // No Pro pitch wording in signup mode (structural turn-ending mentions
    // of upgrade_to_pro in STYLE_RULES are fine — they don't pitch Pro).
    expect(s).not.toMatch(/Pro would genuinely help|once per session is enough/);
  });

  it('renders only the pro directive for nudgeMode=pro and references the tool', () => {
    const s = buildInstruction({ ...BASE, nudgeMode: 'pro' });
    expect(s).toMatch(/PRO_NUDGE/);
    expect(s).not.toMatch(/SIGNUP_NUDGE/);
    expect(s).toMatch(/upgrade_to_pro/);
    // Cadence guidance — tells the LLM not to spam
    expect(s).toMatch(/once per session|don't pitch/i);
  });
});

describe('buildInstruction — DAY_PHASE', () => {
  // 2026-04-29 09:00 in Australia/Melbourne is morning (UTC+10).
  const morningUtc = new Date('2026-04-28T23:00:00Z');
  // 2026-04-29 12:30 Melbourne (lunch window).
  const lunchUtc = new Date('2026-04-29T02:30:00Z');
  // 2026-04-29 19:00 Melbourne (evening).
  const eveningUtc = new Date('2026-04-29T09:00:00Z');
  // 2026-04-29 22:30 Melbourne (concluding).
  const concludingUtc = new Date('2026-04-29T12:30:00Z');

  it('renders morning_greeting when the user has not interacted yet today', () => {
    const s = buildInstruction({ ...BASE, now: morningUtc, hasInteractedToday: false });
    expect(s).toMatch(/DAY_PHASE/);
    expect(s).toMatch(/First contact of the day/);
    expect(s).not.toMatch(/around lunch time/);
  });

  it('renders the morning directive once the user has interacted', () => {
    const s = buildInstruction({ ...BASE, now: morningUtc, hasInteractedToday: true });
    expect(s).toMatch(/DAY_PHASE/);
    expect(s).toMatch(/morning and the user is mid-flow/);
  });

  it('renders the lunch directive when lunch_eaten is missing in profile', () => {
    const s = buildInstruction({
      ...BASE,
      now: lunchUtc,
      hasInteractedToday: true,
      userProfile: {},
    });
    expect(s).toMatch(/DAY_PHASE/);
    expect(s).toMatch(/around lunch time/);
    expect(s).toMatch(/update_user_profile/);
  });

  it('flips lunch → post_lunch once daily.{today}.lunch_eaten is true', () => {
    const s = buildInstruction({
      ...BASE,
      now: lunchUtc,
      hasInteractedToday: true,
      userProfile: { daily: { '2026-04-29': { lunch_eaten: true } } },
    });
    expect(s).toMatch(/DAY_PHASE/);
    expect(s).toMatch(/Past the lunch window/);
    expect(s).not.toMatch(/around lunch time/);
  });

  it('renders evening tone in the 17–21 window', () => {
    const s = buildInstruction({ ...BASE, now: eveningUtc, hasInteractedToday: true });
    expect(s).toMatch(/DAY_PHASE/);
    expect(s).toMatch(/Evening tone/);
  });

  it('renders the concluding tone late in the evening', () => {
    const s = buildInstruction({ ...BASE, now: concludingUtc, hasInteractedToday: true });
    expect(s).toMatch(/DAY_PHASE/);
    expect(s).toMatch(/Late hours/);
  });
});

describe('buildInstruction — workspace cheat-sheet gating', () => {
  it('omits the WORKSPACE cheat-sheet when state is not workspace_connected', () => {
    const s = buildInstruction({ ...BASE, userState: 'google_linked' });
    expect(s).not.toMatch(/WORKSPACE — call_workspace/);
    expect(s).not.toMatch(/messages\.list/);
  });

  it('includes the WORKSPACE cheat-sheet when state is workspace_connected', () => {
    const s = buildInstruction({ ...BASE, userState: 'workspace_connected' });
    expect(s).toMatch(/WORKSPACE — call_workspace/);
    expect(s).toMatch(/messages\.list/);
    expect(s).toMatch(/events\.list/);
    expect(s).toMatch(/tasks\.list/);
    // params is a JSON-encoded STRING — must be explicit to the LLM.
    expect(s).toMatch(/JSON-encoded STRING/);
    // And tell it the recovery path on scope_required.
    expect(s).toMatch(/connect_workspace/);
  });
});
