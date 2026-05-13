import fs from 'node:fs';
import path from 'node:path';

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

const blogDirectory = path.join(process.cwd(), 'content/blog');

export function getBlogPosts() {
  return fs
    .readdirSync(blogDirectory)
    .filter((fileName) => fileName.endsWith('.mdx'))
    .map((fileName) => readBlogPost(fileName.replace(/\.mdx$/, '')))
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function getBlogPost(slug: string) {
  const filePath = path.join(blogDirectory, `${slug}.mdx`);
  if (!fs.existsSync(filePath)) {
    return undefined;
  }
  return readBlogPost(slug);
}

function readBlogPost(slug: string): BlogPost {
  const raw = fs.readFileSync(path.join(blogDirectory, `${slug}.mdx`), 'utf8');
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    throw new Error(`Blog post ${slug} is missing frontmatter`);
  }

  const frontmatterSource = match[1];
  const body = match[2];
  if (frontmatterSource === undefined || body === undefined) {
    throw new Error(`Blog post ${slug} has invalid frontmatter`);
  }

  const frontmatter = parseFrontmatter(frontmatterSource);
  return {
    slug,
    title: getString(frontmatter, 'title'),
    description: getString(frontmatter, 'description'),
    date: getString(frontmatter, 'date'),
    type: getString(frontmatter, 'type') as BlogPost['type'],
    targetSubreddit: getString(frontmatter, 'targetSubreddit'),
    tags: getArray(frontmatter, 'tags'),
    body: body.trim(),
  };
}

function parseFrontmatter(source: string) {
  const record: Record<string, string | string[]> = {};
  for (const line of source.split('\n')) {
    const separator = line.indexOf(':');
    if (separator === -1) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (value.startsWith('[') && value.endsWith(']')) {
      record[key] = value
        .slice(1, -1)
        .split(',')
        .map((item) => item.trim().replace(/^"|"$/g, ''))
        .filter(Boolean);
    } else {
      record[key] = value.replace(/^"|"$/g, '');
    }
  }
  return record;
}

function getString(record: Record<string, string | string[]>, key: string) {
  const value = record[key];
  if (typeof value !== 'string') {
    throw new Error(`Blog frontmatter is missing string field: ${key}`);
  }
  return value;
}

function getArray(record: Record<string, string | string[]>, key: string) {
  const value = record[key];
  if (!Array.isArray(value)) {
    throw new Error(`Blog frontmatter is missing array field: ${key}`);
  }
  return value;
}

export function formatPostDate(date: string) {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

export function renderMarkdownBlocks(markdown: string) {
  const blocks: { type: 'h2' | 'p' | 'ul'; content: string | string[] }[] = [];
  const lines = markdown.split('\n');
  let paragraph: string[] = [];
  let list: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: 'p', content: paragraph.join(' ') });
      paragraph = [];
    }
  };

  const flushList = () => {
    if (list.length > 0) {
      blocks.push({ type: 'ul', content: list });
      list = [];
    }
  };

  for (const line of lines) {
    if (line.startsWith('## ')) {
      flushParagraph();
      flushList();
      blocks.push({ type: 'h2', content: line.replace(/^## /, '') });
    } else if (line.startsWith('- ')) {
      flushParagraph();
      list.push(line.replace(/^- /, ''));
    } else if (line.trim() === '') {
      flushParagraph();
      flushList();
    } else {
      flushList();
      paragraph.push(line.trim());
    }
  }

  flushParagraph();
  flushList();
  return blocks;
}
