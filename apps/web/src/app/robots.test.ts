import { describe, expect, it } from 'vitest';
import robots from './robots';

describe('robots', () => {
  it('allows crawling and points at the sitemap', () => {
    const config = robots();
    expect(config.rules).toBeDefined();
    expect(config.sitemap).toBeDefined();
    const sitemapUrls = Array.isArray(config.sitemap) ? config.sitemap : [config.sitemap];
    expect(sitemapUrls[0]).toMatch(/sitemap\.xml$/);
  });
});
