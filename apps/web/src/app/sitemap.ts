import type { MetadataRoute } from 'next';
import { blogPosts, helpTopics, siteUrl } from '../content/seo';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: siteUrl, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${siteUrl}/blog`, lastModified: now, changeFrequency: 'weekly', priority: 0.8 },
    {
      url: `${siteUrl}/how-it-helps`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    ...helpTopics.map((topic) => ({
      url: `${siteUrl}/how-it-helps/${topic.slug}`,
      lastModified: now,
      changeFrequency: 'monthly' as const,
      priority: 0.9,
    })),
    ...blogPosts.map((post) => ({
      url: `${siteUrl}/blog/${post.slug}`,
      lastModified: new Date(post.publishedAt),
      changeFrequency: 'monthly' as const,
      priority: 0.7,
    })),
  ];
}
