import { getBlogPosts } from '@/lib/blog';
import { absoluteUrl, helpTopics } from '@/lib/marketing';
import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  return [
    { url: absoluteUrl('/'), lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: absoluteUrl('/blog'), lastModified: now, changeFrequency: 'weekly', priority: 0.8 },
    ...helpTopics.map((topic) => ({
      url: absoluteUrl(`/how-it-helps/${topic.slug}`),
      lastModified: now,
      changeFrequency: 'monthly' as const,
      priority: topic.slug === 'overwhelm' ? 0.95 : 0.85,
    })),
    ...getBlogPosts().map((post) => ({
      url: absoluteUrl(`/blog/${post.slug}`),
      lastModified: new Date(post.date),
      changeFrequency: 'monthly' as const,
      priority: 0.7,
    })),
  ];
}
