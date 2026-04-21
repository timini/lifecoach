import { describe, expect, it } from 'vitest';
import { PROFILE_WRITABLE_PATHS, UserProfileSchema, emptyUserProfile } from './userProfile.js';

describe('emptyUserProfile', () => {
  it('produces a fully-null profile with all top-level sections present', () => {
    const p = emptyUserProfile();
    expect(p.name).toBeNull();
    expect(p.age).toBeNull();
    expect(p.location).toEqual({ address: null });
    expect(p.family).toMatchObject({
      relationship_status: null,
      partner_name: null,
      children: null,
      living_situation: null,
    });
    expect(p.goals.short_term).toEqual([]);
  });
});

describe('UserProfileSchema', () => {
  it('parses the example from the spec (two kids, running + garden goals)', () => {
    const parsed = UserProfileSchema.parse({
      name: 'Tim',
      family: { children: 'Two kids, ages 8 and 4. Named Wren and Silvie.' },
      goals: { short_term: ['Running', 'Garden Renovation'] },
    });
    expect(parsed.name).toBe('Tim');
    expect(parsed.family.children).toBe('Two kids, ages 8 and 4. Named Wren and Silvie.');
    expect(parsed.family.partner_name).toBeNull();
    expect(parsed.goals.short_term).toEqual(['Running', 'Garden Renovation']);
    expect(parsed.goals.medium_term).toEqual([]);
  });

  it('rejects unknown top-level keys', () => {
    expect(() => UserProfileSchema.parse({ name: 'T', unknown_field: 'nope' })).toThrow();
  });

  it('rejects negative age', () => {
    expect(() => UserProfileSchema.parse({ age: -5 })).toThrow();
  });
});

describe('PROFILE_WRITABLE_PATHS', () => {
  it('includes every non-goals-array leaf of the schema', () => {
    expect(PROFILE_WRITABLE_PATHS).toContain('name');
    expect(PROFILE_WRITABLE_PATHS).toContain('family.children');
    expect(PROFILE_WRITABLE_PATHS).toContain('occupation.satisfaction');
    expect(PROFILE_WRITABLE_PATHS).toContain('goals.currently_working_on');
  });
});
