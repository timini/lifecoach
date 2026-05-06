/**
 * Shared time helper for practice directives that gate on the user's
 * local-clock window or stamp idempotency by local date. `en-CA` reliably
 * returns YYYY-MM-DD in the requested timezone; `sv-SE` returns 24-hour
 * HH without locale surprises.
 *
 * Originally inlined in eveningGratitude; extracted when day_planning
 * needed the same primitive.
 */

export function localDateAndHour(now: Date, tz: string | null): { date: string; hour: number } {
  const tzOpt = tz ?? 'UTC';
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: tzOpt,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const hourStr = new Intl.DateTimeFormat('sv-SE', {
    timeZone: tzOpt,
    hour: '2-digit',
    hour12: false,
  }).format(now);
  return { date, hour: Number.parseInt(hourStr, 10) };
}
