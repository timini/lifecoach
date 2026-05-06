/**
 * Practice — a toggleable coaching capability.
 *
 * A practice bundles three optional things:
 *   1. A prompt directive injected when the user has it ON (so the LLM
 *      knows when/how to act on it). Receives the full instruction
 *      context plus the practice's own state slice from user.yaml.
 *   2. A set of tools registered when ON (e.g. log_gratitude).
 *   3. An "offer hint" used when OFF, telling the LLM how to recognise
 *      a moment to offer enabling it.
 *
 * The on/off flag lives in user.yaml at `practices.{id}.enabled` (string
 * "true" / boolean true / missing). Practice-specific runtime state
 * (last_logged, entries[], etc) lives at `practices.{id}.*` — schema-
 * free, same as any other profile data.
 */

import type { FunctionTool } from '@google/adk';
import type { UserProfile } from '@lifecoach/shared-types';
import type { InstructionContext } from '../prompt/buildInstruction.js';
import type { UserProfileStore } from '../storage/userProfile.js';

export interface PracticeDeps {
  profileStore: UserProfileStore;
}

export interface PracticeCtx extends InstructionContext {
  /** This practice's own state slice from user.yaml — `practices.{id}.*` */
  practiceState: Record<string, unknown>;
}

export interface Practice {
  /** Stable id, used as the path key in user.yaml — `practices.{id}.*` */
  id: string;
  /** User-facing name shown in settings (mirrors PRACTICE_METADATA.label). */
  label: string;
  /** One-line description (mirrors PRACTICE_METADATA.description). */
  description: string;
  /**
   * Hint injected into the prompt when this practice is OFF — tells the
   * agent how to recognise a moment to offer enabling it. Optional.
   */
  offerHint?: string;
  /**
   * Directive injected into the prompt when this practice is ON. Receives
   * full context + the practice's own state slice. Returns null/empty
   * string to skip this turn (e.g. evening_gratitude only fires after
   * 6pm local).
   */
  directive?: (ctx: PracticeCtx) => string | null;
  /**
   * Few-shot examples injected into the EXAMPLES block when this practice
   * is ON. Same conditional shape as `directive`: return null to add
   * nothing this turn. Distinct from `directive` so a practice can ship
   * its examples even when its directive doesn't need to fire (or vice
   * versa). The string should already include the `GOOD (...)` / `BAD
   * (...)` framing — buildInstruction concatenates verbatim.
   */
  examples?: (ctx: PracticeCtx) => string | null;
  /**
   * Tools the practice exposes when ON. The factory takes shared deps +
   * per-uid scoping. Returns 0..N FunctionTool instances.
   */
  tools?: (deps: PracticeDeps, uid: string) => FunctionTool[];
}

/** Read whether a practice is enabled in a profile. Truthy strings ("true") count. */
export function isPracticeEnabled(profile: UserProfile | undefined, id: string): boolean {
  if (!profile) return false;
  const practices = profile.practices as Record<string, unknown> | undefined;
  if (!practices || typeof practices !== 'object') return false;
  const slot = practices[id] as Record<string, unknown> | undefined;
  if (!slot || typeof slot !== 'object') return false;
  const flag = slot.enabled;
  if (flag === true) return true;
  if (typeof flag === 'string') return flag.toLowerCase() === 'true';
  return false;
}

/** Read a practice's per-instance state slice from a profile (always a record, even if empty). */
export function practiceStateFor(
  profile: UserProfile | undefined,
  id: string,
): Record<string, unknown> {
  if (!profile) return {};
  const practices = profile.practices as Record<string, unknown> | undefined;
  if (!practices || typeof practices !== 'object') return {};
  const slot = practices[id];
  if (!slot || typeof slot !== 'object' || Array.isArray(slot)) return {};
  return slot as Record<string, unknown>;
}
