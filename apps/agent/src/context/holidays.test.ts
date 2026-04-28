import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type HolidaysFetcher, createHolidaysClient, tzToCountry } from './holidays.js';

const SAMPLE_GB_2026 = [
  { date: '2026-01-01', localName: "New Year's Day", name: "New Year's Day", countryCode: 'GB' },
  { date: '2026-04-03', localName: 'Good Friday', name: 'Good Friday', countryCode: 'GB' },
  {
    date: '2026-05-04',
    localName: 'Early May Bank Holiday',
    name: 'Early May Bank Holiday',
    countryCode: 'GB',
  },
  { date: '2026-12-25', localName: 'Christmas Day', name: 'Christmas Day', countryCode: 'GB' },
];

function fakeFetch(body: unknown = SAMPLE_GB_2026, status = 200): HolidaysFetcher {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

describe('tzToCountry', () => {
  it('maps common IANA timezones to ISO country codes', () => {
    expect(tzToCountry('Europe/London')).toBe('GB');
    expect(tzToCountry('Australia/Melbourne')).toBe('AU');
    expect(tzToCountry('America/New_York')).toBe('US');
    expect(tzToCountry('Asia/Tokyo')).toBe('JP');
  });

  it('returns null for unmapped or null timezones', () => {
    expect(tzToCountry('Antarctica/Casey')).toBeNull();
    expect(tzToCountry(null)).toBeNull();
    expect(tzToCountry('')).toBeNull();
  });
});

describe('createHolidaysClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-15T09:00:00Z')); // mid-June, no holidays nearby
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns no holidays when none fall in the next 7 days', async () => {
    const client = createHolidaysClient({ fetcher: fakeFetch() });
    const result = await client.next7Days('GB');
    expect(result).toEqual([]);
  });

  it('returns holidays falling within the next 7 days (inclusive of today)', async () => {
    vi.setSystemTime(new Date('2026-04-30T09:00:00Z')); // 4 days before May 4 BH
    const client = createHolidaysClient({ fetcher: fakeFetch() });
    const result = await client.next7Days('GB');
    expect(result).toEqual([
      {
        date: '2026-05-04',
        localName: 'Early May Bank Holiday',
        countryCode: 'GB',
      },
    ]);
  });

  it('hits the nager.date endpoint for the right year and country', async () => {
    const fetcher = fakeFetch();
    const client = createHolidaysClient({ fetcher });
    await client.next7Days('GB');
    const url = (fetcher as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(url).toBe('https://date.nager.at/api/v3/PublicHolidays/2026/GB');
  });

  it('caches per (year, country) — second call is free', async () => {
    const fetcher = fakeFetch();
    const client = createHolidaysClient({ fetcher });
    await client.next7Days('GB');
    await client.next7Days('GB');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('separate cache entries per country', async () => {
    const fetcher = fakeFetch();
    const client = createHolidaysClient({ fetcher });
    await client.next7Days('GB');
    await client.next7Days('AU');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('crosses the year boundary if the 7-day window spans Dec 31 → Jan 1', async () => {
    vi.setSystemTime(new Date('2026-12-29T09:00:00Z'));
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(SAMPLE_GB_2026), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              date: '2027-01-01',
              localName: "New Year's Day",
              name: "New Year's Day",
              countryCode: 'GB',
            },
          ]),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      );
    const client = createHolidaysClient({ fetcher });
    const result = await client.next7Days('GB');
    expect(result.map((h) => h.date)).toEqual(['2027-01-01']);
    expect(fetcher).toHaveBeenCalledTimes(2); // both years fetched
  });

  it('returns empty list on upstream non-200 (graceful)', async () => {
    const client = createHolidaysClient({ fetcher: fakeFetch('nope', 500) });
    const result = await client.next7Days('GB');
    expect(result).toEqual([]);
  });

  it('returns empty list on fetch throw (network drop)', async () => {
    const client = createHolidaysClient({
      fetcher: vi.fn().mockRejectedValue(new Error('boom')),
    });
    expect(await client.next7Days('GB')).toEqual([]);
  });
});
