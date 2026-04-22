import { z } from 'zod';

/**
 * Lifecoach user profile. **Schema-free by design** — the coach invents
 * whatever keys the conversation surfaces (`pets`, `morning_routine`,
 * `volunteering`, etc.), and the UI renders the tree generically. Do not
 * re-impose a closed object shape here; see
 * memory/feedback_yaml_schema_free.md.
 *
 * Starter template below is a hint, not a contract — it's what an empty
 * profile looks like the first time, but users and the coach can add or
 * remove top-level keys freely.
 */

export const UserProfileSchema = z.record(z.string(), z.unknown());

export type UserProfile = z.infer<typeof UserProfileSchema>;

/**
 * Starting shape for a brand new user. Matches the Lifecoach spec's
 * initial template, with nulls preserved so the coach sees "I don't know
 * this yet" and asks naturally.
 */
export function emptyUserProfile(): UserProfile {
  return {
    name: null,
    age: null,
    location: { address: null },
    family: {
      relationship_status: null,
      partner_name: null,
      children: null,
      living_situation: null,
    },
    occupation: {
      title: null,
      industry: null,
      work_style: null,
      satisfaction: null,
    },
    health: {
      exercise_habits: null,
      sleep_quality: null,
    },
    personality: {
      strengths: null,
      challenges: null,
      values: null,
    },
    goals: {
      short_term: [],
      medium_term: [],
      long_term: [],
      currently_working_on: null,
    },
    preferences: {
      communication_style: null,
      coaching_focus: null,
      session_preference: null,
    },
  };
}
