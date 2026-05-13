import type { MetadataRoute } from 'next';
import { getBlogPosts } from '../lib/marketing/blog';
import { featurePages } from '../lib/marketing/feature-pages';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://lifecoach.ai';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    {
      url: siteUrl,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: `${siteUrl}/blog`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    {
      url: `${siteUrl}/how-it-helps`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.85,
    },
    ...featurePages.map((page) => ({
      url: `${siteUrl}/how-it-helps/${page.topic}`,
      lastModified: now,
      changeFrequency: 'monthly' as const,
      priority: page.topic === 'overwhelm' ? 0.95 : 0.85,
    })),
    ...getBlogPosts().map((post) => ({
      url: `${siteUrl}/blog/${post.slug}`,
      lastModified: new Date(`${post.date}T00:00:00Z`),
      changeFrequency: 'monthly' as const,
      priority: 0.7,
    })),
  ];
}
