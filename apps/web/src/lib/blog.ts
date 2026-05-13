import fs from 'node:fs';
import path from 'node:path';
import { absoluteUrl } from './marketing';

const contentDirectory = path.join(process.cwd(), 'src/content/blog');

export type BlogPost = {
  slug: string;
  title: string;
  description: string;
  date: string;
  type: 'evidence-backed' | 'personal-story';
  targetSubreddit: string;
  tags: string[];
  body: string;
};

function parseFrontmatter(source: string) {
  const match = source.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

  if (!match) {
    throw new Error('Blog posts must start with YAML-like frontmatter.');
  }

  const [, frontmatter = '', body = ''] = match;
  const metadata: Record<string, string> = {};

  for (const line of frontmatter.split('\n')) {
    const separatorIndex = line.indexOf(':');

    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line
      .slice(separatorIndex + 1)
      .trim()
      .replace(/^"|"$/g, '');
    metadata[key] = value;
  }

  return { metadata, body: body.trim() };
}

function requiredMetadata(metadata: Record<string, string>, key: string) {
  const value = metadata[key];

  if (!value) {
    throw new Error(`Missing required blog frontmatter: ${key}`);
  }

  return value;
}

function postType(value: string): BlogPost['type'] {
  if (value === 'evidence-backed' || value === 'personal-story') {
    return value;
  }

  throw new Error(`Unsupported blog post type: ${value}`);
}

export function getBlogPosts(): BlogPost[] {
  return fs
    .readdirSync(contentDirectory)
    .filter((file) => file.endsWith('.mdx'))
    .map((file) => {
      const slug = file.replace(/\.mdx$/, '');
      const source = fs.readFileSync(path.join(contentDirectory, file), 'utf8');
      const { metadata, body } = parseFrontmatter(source);
      const tags = requiredMetadata(metadata, 'tags')
        .split(',')
        .map((tag) => tag.trim());

      return {
        slug,
        title: requiredMetadata(metadata, 'title'),
        description: requiredMetadata(metadata, 'description'),
        date: requiredMetadata(metadata, 'date'),
        type: postType(requiredMetadata(metadata, 'type')),
        targetSubreddit: requiredMetadata(metadata, 'targetSubreddit'),
        tags,
        body,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function getBlogPost(slug: string) {
  return getBlogPosts().find((post) => post.slug === slug);
}

export function getRedditShareUrl(post: BlogPost) {
  const subreddit = post.targetSubreddit.replace(/^r\//, '');
  const postUrl = absoluteUrl(`/blog/${post.slug}`);
  const title = `${post.title} — transparent founder post from Lifecoach`;
  return `https://www.reddit.com/r/${subreddit}/submit?url=${encodeURIComponent(postUrl)}&title=${encodeURIComponent(title)}`;
}
