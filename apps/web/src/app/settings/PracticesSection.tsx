'use client';

/**
 * Practices tab — toggle list backed by user.yaml at `practices.{id}.enabled`.
 *
 * The profile lives at the parent (SettingsPage) which already PATCHes the
 * whole document on every change; this component just surfaces the right
 * keys and bubbles a partial update upward. Adding a practice requires no
 * change here — `PRACTICE_METADATA` from shared-types drives the rendered
 * list.
 */

import { PRACTICE_METADATA } from '@lifecoach/shared-types';
import type { JsonObject } from '@lifecoach/ui';

interface Props {
  profile: JsonObject;
  onChange: (next: JsonObject) => void;
}

export function PracticesSection({ profile, onChange }: Props) {
  const practices = isObject(profile.practices) ? (profile.practices as JsonObject) : {};

  function toggle(id: string, next: boolean) {
    const slot = isObject(practices[id]) ? (practices[id] as JsonObject) : {};
    const updatedPractices: JsonObject = {
      ...practices,
      [id]: { ...slot, enabled: next },
    };
    onChange({ ...profile, practices: updatedPractices });
  }

  return (
    <section className="flex flex-col gap-3" aria-label="Practices">
      <p className="text-xs text-muted-foreground">
        Coaching practices you can switch on and off. The coach will only act on a practice when
        it's enabled.
      </p>
      <ul className="flex flex-col gap-2">
        {PRACTICE_METADATA.map((p) => {
          const slot = isObject(practices[p.id]) ? (practices[p.id] as JsonObject) : {};
          const enabled = readEnabled(slot.enabled);
          return (
            <li
              key={p.id}
              className="flex items-start justify-between gap-3 rounded-md border border-border bg-background px-3 py-2"
            >
              <div className="flex flex-col">
                <span className="text-sm font-medium">{p.label}</span>
                <span className="text-xs text-muted-foreground">{p.description}</span>
              </div>
              <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                <span>{enabled ? 'On' : 'Off'}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  aria-label={`Toggle ${p.label}`}
                  onClick={() => toggle(p.id, !enabled)}
                  className={`relative h-6 w-11 rounded-full transition-colors ${
                    enabled ? 'bg-accent' : 'bg-border'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                      enabled ? 'translate-x-5' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function isObject(v: unknown): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function readEnabled(v: unknown): boolean {
  if (v === true) return true;
  if (typeof v === 'string') return v.toLowerCase() === 'true';
  return false;
}
