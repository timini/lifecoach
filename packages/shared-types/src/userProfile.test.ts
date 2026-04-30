import { describe, expect, it } from 'vitest';
import { UserProfileSchema, emptyUserProfile } from './userProfile.js';

describe('emptyUserProfile', () => {
  it('returns the starter template with null leaves', () => {
    const p = emptyUserProfile();
    expect(p.name).toBeNull();
    expect(p.location).toEqual({ address: null });
    expect(p.goals).toMatchObject({
      short_term: [],
      medium_term: [],
      long_term: [],
      currently_working_on: null,
    });
  });
});

describe('UserProfileSchema (schema-free)', () => {
  it('accepts the starter template', () => {
    expect(() => UserProfileSchema.parse(emptyUserProfile())).not.toThrow();
  });

  it('accepts arbitrary top-level keys invented by the coach', () => {
    const parsed = UserProfileSchema.parse({
      name: 'Alex',
      pets: { name: 'Cosmo', species: 'dog' },
      morning_routine: ['stretch', 'shower', 'breakfast'],
      volunteering: 'community garden weekends',
    });
    expect(parsed).toMatchObject({
      pets: { name: 'Cosmo', species: 'dog' },
      morning_routine: ['stretch', 'shower', 'breakfast'],
    });
  });

  it('accepts deeply nested shapes without constraint', () => {
    const input = {
      relationships: {
        partner: { name: 'Jordan', years_together: 4, notes: ['thoughtful'] },
        friends: ['A', 'B'],
      },
    };
    expect(UserProfileSchema.parse(input)).toEqual(input);
  });

  it('rejects non-object inputs', () => {
    expect(() => UserProfileSchema.parse('nope')).toThrow();
    expect(() => UserProfileSchema.parse([1, 2, 3])).toThrow();
  });
});
