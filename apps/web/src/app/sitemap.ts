import type { MetadataRoute } from 'next';
import { absoluteUrl, blogPosts, featureTopics } from '../content/marketing';

export default function sitemap(): MetadataRoute.Sitemap {
  const staticRoutes = ['', '/blog'].map((path) => ({
    url: absoluteUrl(path || '/'),
    lastModified: new Date('2026-05-12'),
    changeFrequency: 'weekly' as const,
    priority: path ? 0.8 : 1,
  }));

  const featureRoutes = featureTopics.map((topic) => ({
    url: absoluteUrl(`/how-it-helps/${topic.slug}`),
    lastModified: new Date('2026-05-12'),
    changeFrequency: 'weekly' as const,
    priority: topic.slug === 'overwhelm' ? 0.95 : 0.85,
  }));

  const blogRoutes = blogPosts.map((post) => ({
    url: absoluteUrl(`/blog/${post.slug}`),
    lastModified: new Date(post.publishedAt),
    changeFrequency: 'monthly' as const,
    priority: 0.7,
  }));

  return [...staticRoutes, ...featureRoutes, ...blogRoutes];
}
