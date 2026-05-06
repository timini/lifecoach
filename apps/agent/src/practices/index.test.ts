import { PRACTICE_METADATA } from '@lifecoach/shared-types';
import { describe, expect, it } from 'vitest';
import {
  PRACTICES,
  getDisabledPractices,
  getEnabledPractices,
  isPracticeEnabled,
  practiceStateFor,
} from './index.js';

describe('practices registry parity', () => {
  it('every code-side practice has a matching shared-types metadata entry', () => {
    const codeIds = PRACTICES.map((p) => p.id).sort();
    const metaIds = PRACTICE_METADATA.map((m) => m.id)
      .slice()
      .sort();
    expect(codeIds).toEqual(metaIds);
  });

  it('label and description in code match the shared metadata (single source of truth)', () => {
    for (const p of PRACTICES) {
      const meta = PRACTICE_METADATA.find((m) => m.id === p.id);
      expect(meta).toBeDefined();
      expect(p.label).toBe(meta?.label);
      expect(p.description).toBe(meta?.description);
    }
  });
});

describe('isPracticeEnabled', () => {
  it('returns false on missing profile / missing slot / missing flag', () => {
    expect(isPracticeEnabled(undefined, 'evening_gratitude')).toBe(false);
    expect(isPracticeEnabled({}, 'evening_gratitude')).toBe(false);
    expect(isPracticeEnabled({ practices: {} }, 'evening_gratitude')).toBe(false);
    expect(isPracticeEnabled({ practices: { evening_gratitude: {} } }, 'evening_gratitude')).toBe(
      false,
    );
  });

  it('treats boolean true and string "true" / "TRUE" as enabled', () => {
    expect(
      isPracticeEnabled(
        { practices: { evening_gratitude: { enabled: true } } },
        'evening_gratitude',
      ),
    ).toBe(true);
    expect(
      isPracticeEnabled(
        { practices: { evening_gratitude: { enabled: 'true' } } },
        'evening_gratitude',
      ),
    ).toBe(true);
    expect(
      isPracticeEnabled(
        { practices: { evening_gratitude: { enabled: 'TRUE' } } },
        'evening_gratitude',
      ),
    ).toBe(true);
  });

  it('rejects falsy / non-true values', () => {
    expect(
      isPracticeEnabled(
        { practices: { evening_gratitude: { enabled: false } } },
        'evening_gratitude',
      ),
    ).toBe(false);
    expect(
      isPracticeEnabled(
        { practices: { evening_gratitude: { enabled: 'false' } } },
        'evening_gratitude',
      ),
    ).toBe(false);
    expect(
      isPracticeEnabled(
        { practices: { evening_gratitude: { enabled: 1 as unknown as boolean } } },
        'evening_gratitude',
      ),
    ).toBe(false);
  });
});

describe('practiceStateFor', () => {
  it('returns the slice under practices.{id} as a record', () => {
    const profile = {
      practices: {
        evening_gratitude: {
          enabled: true,
          last_logged: '2026-04-28',
          entries: [{ date: '2026-04-28', text: 'sunshine', ts: '2026-04-28T19:00:00Z' }],
        },
      },
    };
    const state = practiceStateFor(profile, 'evening_gratitude');
    expect(state.last_logged).toBe('2026-04-28');
    expect(Array.isArray(state.entries)).toBe(true);
  });

  it('returns an empty record when slot is missing', () => {
    expect(practiceStateFor({}, 'evening_gratitude')).toEqual({});
  });
});

describe('getEnabledPractices / getDisabledPractices', () => {
  it('partitions registered practices by their enabled flag', () => {
    const profile = {
      practices: {
        evening_gratitude: { enabled: true },
        // journaling missing → treated as off
      },
    };
    const enabled = getEnabledPractices(profile);
    const disabled = getDisabledPractices(profile);
    expect(enabled.map((p) => p.id)).toEqual(['evening_gratitude']);
    expect(disabled.map((p) => p.id)).toEqual(['journaling', 'day_planning']);
  });

  it('treats no-profile as everything-disabled', () => {
    expect(getEnabledPractices(undefined)).toEqual([]);
    expect(getDisabledPractices(undefined).length).toBe(PRACTICES.length);
  });
});
