import { z } from 'zod';

/**
 * Canonical Lifecoach user profile. Mirrors the user.yaml spec verbatim —
 * every leaf is nullable so the agent can see at a glance what it knows and
 * what it has yet to discover.
 */

export const UserProfileSchema = z
  .object({
    name: z.string().nullable().default(null),
    age: z.number().int().positive().nullable().default(null),
    location: z
      .object({
        address: z.string().nullable().default(null),
      })
      .default({ address: null }),
    family: z
      .object({
        relationship_status: z.string().nullable().default(null),
        partner_name: z.string().nullable().default(null),
        children: z.string().nullable().default(null),
        living_situation: z.string().nullable().default(null),
      })
      .default({
        relationship_status: null,
        partner_name: null,
        children: null,
        living_situation: null,
      }),
    occupation: z
      .object({
        title: z.string().nullable().default(null),
        industry: z.string().nullable().default(null),
        work_style: z.string().nullable().default(null),
        satisfaction: z.string().nullable().default(null),
      })
      .default({ title: null, industry: null, work_style: null, satisfaction: null }),
    health: z
      .object({
        exercise_habits: z.string().nullable().default(null),
        sleep_quality: z.string().nullable().default(null),
      })
      .default({ exercise_habits: null, sleep_quality: null }),
    personality: z
      .object({
        strengths: z.string().nullable().default(null),
        challenges: z.string().nullable().default(null),
        values: z.string().nullable().default(null),
      })
      .default({ strengths: null, challenges: null, values: null }),
    goals: z
      .object({
        short_term: z.array(z.string()).default([]),
        medium_term: z.array(z.string()).default([]),
        long_term: z.array(z.string()).default([]),
        currently_working_on: z.string().nullable().default(null),
      })
      .default({ short_term: [], medium_term: [], long_term: [], currently_working_on: null }),
    preferences: z
      .object({
        communication_style: z.string().nullable().default(null),
        coaching_focus: z.string().nullable().default(null),
        session_preference: z.string().nullable().default(null),
      })
      .default({ communication_style: null, coaching_focus: null, session_preference: null }),
  })
  .strict();

export type UserProfile = z.infer<typeof UserProfileSchema>;

/** Produces a brand-new, fully-null profile. */
export function emptyUserProfile(): UserProfile {
  return UserProfileSchema.parse({});
}

/** The canonical set of dotted paths the agent is allowed to write. */
export const PROFILE_WRITABLE_PATHS = [
  'name',
  'age',
  'location.address',
  'family.relationship_status',
  'family.partner_name',
  'family.children',
  'family.living_situation',
  'occupation.title',
  'occupation.industry',
  'occupation.work_style',
  'occupation.satisfaction',
  'health.exercise_habits',
  'health.sleep_quality',
  'personality.strengths',
  'personality.challenges',
  'personality.values',
  'goals.short_term',
  'goals.medium_term',
  'goals.long_term',
  'goals.currently_working_on',
  'preferences.communication_style',
  'preferences.coaching_focus',
  'preferences.session_preference',
] as const;

export type ProfileWritablePath = (typeof PROFILE_WRITABLE_PATHS)[number];
