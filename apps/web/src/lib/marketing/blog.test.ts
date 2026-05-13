import { describe, expect, it } from 'vitest';
import { formatPostDate, getBlogPost, getBlogPosts, renderMarkdownBlocks } from './blog';

describe('blog frontmatter + listing', () => {
  it('getBlogPosts returns every MDX file in content/blog, sorted newest first', () => {
    const posts = getBlogPosts();
    expect(posts.length).toBeGreaterThanOrEqual(3);
    // Sorted by date desc.
    for (let i = 0; i < posts.length - 1; i += 1) {
      const post = posts[i];
      const next = posts[i + 1];
      if (!post || !next) {
        continue;
      }
      expect(post.date >= next.date).toBe(true);
    }
  });

  it('every post has the fields the post page renders', () => {
    for (const post of getBlogPosts()) {
      expect(post.slug.length).toBeGreaterThan(0);
      expect(post.title.length).toBeGreaterThan(0);
      expect(post.description.length).toBeGreaterThan(0);
      // YYYY-MM-DD shape so sitemap.ts can parse + sort.
      expect(post.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(['evidence-backed', 'personal-story']).toContain(post.type);
      // The blog detail page builds the Reddit share URL by stripping
      // a leading `r/`; a missing or oddly-shaped subreddit would
      // produce a broken share URL.
      expect(post.targetSubreddit.length).toBeGreaterThan(0);
      expect(post.tags.length).toBeGreaterThan(0);
      expect(post.body.length).toBeGreaterThan(0);
    }
  });

  it('getBlogPost returns the matching post by slug', () => {
    const all = getBlogPosts();
    const first = all[0];
    if (!first) {
      throw new Error('expected at least one post');
    }
    expect(getBlogPost(first.slug)?.slug).toBe(first.slug);
  });

  it('getBlogPost returns undefined for an unknown slug', () => {
    expect(getBlogPost('not-a-real-post-slug-xyz')).toBeUndefined();
  });
});

describe('formatPostDate', () => {
  it('formats a YYYY-MM-DD as a localised medium date', () => {
    expect(formatPostDate('2026-03-15')).toMatch(/Mar/);
  });
});

describe('renderMarkdownBlocks', () => {
  // The post page renders these blocks as React; getting the block
  // sequence wrong (e.g. swallowing a `## heading` because of trailing
  // whitespace) would silently drop content.
  it('returns h2 / paragraph / unordered-list blocks in source order', () => {
    const blocks = renderMarkdownBlocks(
      [
        '## Setup',
        '',
        'First, breathe.',
        'Then notice.',
        '',
        '- one',
        '- two',
        '',
        '## Wrap',
        '',
        'A closing thought.',
      ].join('\n'),
    );

    expect(blocks).toEqual([
      { type: 'h2', content: 'Setup' },
      { type: 'p', content: 'First, breathe. Then notice.' },
      { type: 'ul', content: ['one', 'two'] },
      { type: 'h2', content: 'Wrap' },
      { type: 'p', content: 'A closing thought.' },
    ]);
  });

  it('flushes a trailing list / paragraph at EOF', () => {
    expect(renderMarkdownBlocks('- a\n- b')).toEqual([{ type: 'ul', content: ['a', 'b'] }]);
    expect(renderMarkdownBlocks('Just a paragraph.')).toEqual([
      { type: 'p', content: 'Just a paragraph.' },
    ]);
  });
});
