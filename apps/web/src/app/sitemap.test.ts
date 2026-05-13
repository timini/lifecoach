import { describe, expect, it } from 'vitest';
import sitemap from './sitemap';

describe('sitemap', () => {
  it('includes the home page, /blog, /how-it-helps and every topic + blog post', () => {
    const entries = sitemap();
    const urls = entries.map((e) => e.url);

    expect(urls).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/\/$|^https:\/\/[^/]+$/),
        expect.stringMatching(/\/blog$/),
        expect.stringMatching(/\/how-it-helps$/),
        expect.stringMatching(/\/how-it-helps\/overwhelm$/),
        expect.stringMatching(/\/how-it-helps\/adhd$/),
        expect.stringMatching(/\/how-it-helps\/personal-assistant$/),
      ]),
    );

    // No duplicate URLs — duplicates cause Google to flag the sitemap.
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('gives /how-it-helps/overwhelm the lead positioning priority', () => {
    const entries = sitemap();
    const overwhelm = entries.find((e) => e.url.endsWith('/how-it-helps/overwhelm'));
    expect(overwhelm?.priority).toBe(0.95);
  });
});
