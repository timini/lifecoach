/**
 * Public-holidays client backed by date.nager.at — free, no auth, unlimited.
 *
 * Holidays are stable across a year, so we cache per (year, country) for the
 * lifetime of the process. Across-process duplicates are fine; each Cloud
 * Run instance does at most one fetch per year per country it sees.
 *
 * The /chat handler asks `next7Days(countryCode)` and the prompt is rendered
 * only when the list is non-empty — silence-on-clear keeps the prompt lean.
 *
 * Country code comes from `LocationCtx.country` (Open-Meteo gives us the
 * coordinate-derived country in the location block). We deliberately don't
 * infer from timezone — that's wrong for travelers.
 */

export interface Holiday {
  date: string; // ISO YYYY-MM-DD
  localName: string;
  countryCode: string;
}

export type HolidaysFetcher = (url: string) => Promise<Response>;

export interface HolidaysClient {
  /** All holidays in the 7-day window starting today (inclusive). Empty list on any error. */
  next7Days(countryCode: string): Promise<Holiday[]>;
}

interface NagerEntry {
  date: string;
  localName: string;
  name: string;
  countryCode: string;
}

export function createHolidaysClient(
  deps: {
    fetcher?: HolidaysFetcher;
    now?: () => Date;
  } = {},
): HolidaysClient {
  const fetcher = deps.fetcher ?? ((url: string) => fetch(url));
  const now = deps.now ?? (() => new Date());
  // Cache key: `${year}-${countryCode}`. Holidays for a year don't change
  // mid-process, and the data is small, so we keep it indefinitely.
  const cache = new Map<string, Promise<Holiday[]>>();

  async function fetchYear(year: number, countryCode: string): Promise<Holiday[]> {
    const url = `https://date.nager.at/api/v3/PublicHolidays/${year}/${countryCode}`;
    try {
      const res = await fetcher(url);
      if (res.status !== 200) return [];
      const body = (await res.json()) as NagerEntry[];
      return body.map((h) => ({
        date: h.date,
        localName: h.localName,
        countryCode: h.countryCode,
      }));
    } catch {
      return [];
    }
  }

  function getYear(year: number, countryCode: string): Promise<Holiday[]> {
    const key = `${year}-${countryCode}`;
    let entry = cache.get(key);
    if (!entry) {
      entry = fetchYear(year, countryCode);
      cache.set(key, entry);
    }
    return entry;
  }

  return {
    async next7Days(countryCode: string): Promise<Holiday[]> {
      const today = now();
      const todayStr = isoDate(today);
      // 7-day window: today + next 6 days (so 7 calendar days total).
      const end = new Date(today.getTime() + 7 * 24 * 60 * 60_000);
      const endStr = isoDate(end);

      // Window may cross a year boundary — fetch both years in that case.
      const yearStart = today.getUTCFullYear();
      const yearEnd = end.getUTCFullYear();
      const years = yearStart === yearEnd ? [yearStart] : [yearStart, yearEnd];
      const lists = await Promise.all(years.map((y) => getYear(y, countryCode)));
      const all = lists.flat();
      return all.filter((h) => h.date >= todayStr && h.date <= endStr);
    },
  };
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Coarse IANA-timezone → ISO-3166-1-alpha-2 country code lookup. Covers the
 * common cases without pulling in a 600-row tz database. Falls through to
 * `null` for anything unmapped — the holidays block then just doesn't render
 * (the agent loses nothing). Add more rows as user data shows demand.
 *
 * Why not use a reverse-geocode API: each /chat would pay a network call to
 * resolve country, and the data we have (IANA tz string from the browser)
 * already encodes country at city granularity — wasteful to re-fetch.
 */
const TZ_TO_COUNTRY: Record<string, string> = {
  // United Kingdom + Ireland
  'Europe/London': 'GB',
  'Europe/Belfast': 'GB',
  'Europe/Dublin': 'IE',
  // Western + Central Europe
  'Europe/Paris': 'FR',
  'Europe/Madrid': 'ES',
  'Europe/Lisbon': 'PT',
  'Europe/Berlin': 'DE',
  'Europe/Brussels': 'BE',
  'Europe/Amsterdam': 'NL',
  'Europe/Luxembourg': 'LU',
  'Europe/Vienna': 'AT',
  'Europe/Zurich': 'CH',
  'Europe/Rome': 'IT',
  'Europe/Athens': 'GR',
  'Europe/Stockholm': 'SE',
  'Europe/Oslo': 'NO',
  'Europe/Copenhagen': 'DK',
  'Europe/Helsinki': 'FI',
  'Europe/Warsaw': 'PL',
  'Europe/Prague': 'CZ',
  'Europe/Budapest': 'HU',
  'Europe/Bucharest': 'RO',
  'Europe/Sofia': 'BG',
  // Americas
  'America/New_York': 'US',
  'America/Chicago': 'US',
  'America/Denver': 'US',
  'America/Los_Angeles': 'US',
  'America/Phoenix': 'US',
  'America/Anchorage': 'US',
  'America/Honolulu': 'US',
  'America/Toronto': 'CA',
  'America/Vancouver': 'CA',
  'America/Edmonton': 'CA',
  'America/Halifax': 'CA',
  'America/Mexico_City': 'MX',
  'America/Sao_Paulo': 'BR',
  'America/Buenos_Aires': 'AR',
  'America/Santiago': 'CL',
  // Oceania
  'Australia/Sydney': 'AU',
  'Australia/Melbourne': 'AU',
  'Australia/Brisbane': 'AU',
  'Australia/Perth': 'AU',
  'Australia/Adelaide': 'AU',
  'Australia/Hobart': 'AU',
  'Pacific/Auckland': 'NZ',
  // Asia
  'Asia/Tokyo': 'JP',
  'Asia/Seoul': 'KR',
  'Asia/Shanghai': 'CN',
  'Asia/Hong_Kong': 'HK',
  'Asia/Taipei': 'TW',
  'Asia/Singapore': 'SG',
  'Asia/Kuala_Lumpur': 'MY',
  'Asia/Bangkok': 'TH',
  'Asia/Jakarta': 'ID',
  'Asia/Manila': 'PH',
  'Asia/Kolkata': 'IN',
  'Asia/Dubai': 'AE',
  'Asia/Tel_Aviv': 'IL',
  'Asia/Jerusalem': 'IL',
  // Africa
  'Africa/Cairo': 'EG',
  'Africa/Johannesburg': 'ZA',
  'Africa/Lagos': 'NG',
  'Africa/Nairobi': 'KE',
};

export function tzToCountry(tz: string | null): string | null {
  if (!tz) return null;
  return TZ_TO_COUNTRY[tz] ?? null;
}
