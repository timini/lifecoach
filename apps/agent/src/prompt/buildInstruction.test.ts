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
  it('always includes the persona block', () => {
    const s = buildInstruction(BASE);
    expect(s).toMatch(/warm, supportive life coach/i);
  });

  it('always includes the current date/time', () => {
    const s = buildInstruction(BASE);
    expect(s).toMatch(/2026-04-21/);
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
      },
    });
    expect(s).toMatch(/Melbourne/);
    expect(s).toMatch(/18\.5/);
    expect(s).toMatch(/forecast/i);
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
        name: 'Tim',
        age: null,
        location: { address: null },
        family: {
          relationship_status: null,
          partner_name: null,
          children: 'Two kids, ages 8 and 4. Named Wren and Silvie.',
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
    expect(s).toMatch(/name: Tim/);
    expect(s).toMatch(/Wren and Silvie/);
    expect(s).toMatch(/partner_name: null/);
    // The "what you don't know" guidance must be present
    expect(s).toMatch(/null means you don't know yet/);
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
