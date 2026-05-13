import { describe, expect, it } from 'vitest';
import { featurePages, getFeaturePage } from './feature-pages';

describe('feature-pages', () => {
  // The funnel exists because of these topics. Locking the slugs in a
  // test means a typo on rename (or a removed topic) breaks the build
  // before a PR ships with broken canonical URLs / broken Reddit
  // share links pointing at /how-it-helps/<old-slug>.
  it('exposes the eight positioning topics in a stable order', () => {
    expect(featurePages.map((page) => page.topic)).toEqual([
      'overwhelm',
      'adhd',
      'depression',
      'anxiety',
      'wellness',
      'career',
      'menopause',
      'personal-assistant',
    ]);
  });

  it('every page has the SEO fields the topic template renders', () => {
    for (const page of featurePages) {
      expect(page.title.length).toBeGreaterThan(0);
      expect(page.metaTitle.length).toBeGreaterThan(0);
      expect(page.description.length).toBeGreaterThan(0);
      expect(page.h1.length).toBeGreaterThan(0);
      expect(page.eyebrow.length).toBeGreaterThan(0);
      expect(page.opener.length).toBeGreaterThan(0);
      expect(page.keyphrases.length).toBeGreaterThan(0);
      expect(page.useCases.length).toBeGreaterThan(0);
      expect(page.ctaPrompt.length).toBeGreaterThan(0);
      // FAQ feeds the FAQPage JSON-LD; an empty array would emit an
      // invalid schema.org document.
      expect(page.faq.length).toBeGreaterThan(0);
      for (const item of page.faq) {
        expect(item.question.length).toBeGreaterThan(0);
        expect(item.answer.length).toBeGreaterThan(0);
      }
    }
  });

  it('getFeaturePage returns the matching page', () => {
    expect(getFeaturePage('overwhelm')?.topic).toBe('overwhelm');
    expect(getFeaturePage('adhd')?.title).toMatch(/ADHD/i);
  });

  it('getFeaturePage returns undefined for an unknown topic', () => {
    expect(getFeaturePage('does-not-exist')).toBeUndefined();
  });
});
