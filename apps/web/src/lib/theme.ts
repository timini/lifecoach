/**
 * Theme resolution + DOM/localStorage glue.
 *
 * Three choices (`light`, `dark`, `system`) collapse into two resolved
 * themes (`light`, `dark`) by checking `prefers-color-scheme` for the
 * `system` case. The resolved theme is written to <html data-theme="…"> so
 * the CSS-var overrides in `globals.css` cascade through every component.
 *
 * The pre-hydration `<script>` in `app/layout.tsx` mirrors this logic so
 * the page never paints in the wrong theme; React-side `setTheme` is the
 * runtime path used after first paint (e.g. via the AccountMenu).
 */

export type ThemeChoice = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'lifecoach.theme';

const VALID: ReadonlySet<ThemeChoice> = new Set(['light', 'dark', 'system']);

export function getThemeChoice(): ThemeChoice {
  if (typeof window === 'undefined') return 'system';
  const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (raw && (VALID as Set<string>).has(raw)) return raw as ThemeChoice;
  return 'system';
}

export function resolveTheme(choice: ThemeChoice): ResolvedTheme {
  if (choice === 'light' || choice === 'dark') return choice;
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyResolvedTheme(theme: ResolvedTheme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
}

export function setTheme(choice: ThemeChoice): void {
  if (!(VALID as Set<string>).has(choice)) {
    throw new Error(`setTheme: invalid choice "${choice}"`);
  }
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(THEME_STORAGE_KEY, choice);
  }
  applyResolvedTheme(resolveTheme(choice));
}
