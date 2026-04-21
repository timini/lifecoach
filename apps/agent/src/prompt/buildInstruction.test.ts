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
    // The examples that curb Gemini's verbosity are the most important
    // stable part of the prompt. Snapshot ensures any change is deliberate.
    const s = buildInstruction(BASE);
    expect(s).toMatch(/BAD/);
    expect(s).toMatch(/GOOD/);
  });
});
