/**
 * Practices registry. Every entry here must have a matching record in
 * PRACTICE_METADATA (shared-types) — the parity check below crashes the
 * module load if they diverge, surfacing the mismatch in CI rather than
 * silently dropping a practice from the settings UI.
 *
 * Adding a new practice:
 *   1. Append to PRACTICE_METADATA in packages/shared-types/src/practices.ts.
 *   2. Add a new file here exporting a Practice.
 *   3. Add it to PRACTICES below.
 *   4. The wiring in server.ts and buildInstruction.ts already iterates
 *      this array — no further edits needed.
 */

import { PRACTICE_METADATA, type UserProfile } from '@lifecoach/shared-types';
import { eveningGratitude } from './eveningGratitude.js';
import { journaling } from './journaling.js';
import { isPracticeEnabled, practiceStateFor } from './types.js';
import type { Practice } from './types.js';

export const PRACTICES: readonly Practice[] = [eveningGratitude, journaling] as const;

// Parity check — runs at module load. Any mismatch fails fast and tests
// catch it in CI long before a real chat hits a missing toggle.
{
  const codeIds = new Set(PRACTICES.map((p) => p.id));
  const metaIds = new Set(PRACTICE_METADATA.map((m) => m.id));
  const onlyInCode = [...codeIds].filter((id) => !metaIds.has(id));
  const onlyInMeta = [...metaIds].filter((id) => !codeIds.has(id));
  if (onlyInCode.length > 0 || onlyInMeta.length > 0) {
    throw new Error(
      `Practices registry mismatch: only-in-code=[${onlyInCode.join(',')}] only-in-metadata=[${onlyInMeta.join(',')}]`,
    );
  }
  // Label/description must also agree so the settings UI matches the runtime.
  for (const p of PRACTICES) {
    const meta = PRACTICE_METADATA.find((m) => m.id === p.id);
    if (!meta) continue; // guarded above
    if (meta.label !== p.label || meta.description !== p.description) {
      throw new Error(
        `Practice "${p.id}" label/description in code does not match shared-types metadata.`,
      );
    }
  }
}

/** Return the subset of practices the user has switched on. */
export function getEnabledPractices(profile: UserProfile | undefined): Practice[] {
  return PRACTICES.filter((p) => isPracticeEnabled(profile, p.id));
}

/** Return the subset the user has NOT switched on (i.e. candidates for the agent to offer). */
export function getDisabledPractices(profile: UserProfile | undefined): Practice[] {
  return PRACTICES.filter((p) => !isPracticeEnabled(profile, p.id));
}

export { isPracticeEnabled, practiceStateFor };
export type { Practice, PracticeCtx, PracticeDeps } from './types.js';
