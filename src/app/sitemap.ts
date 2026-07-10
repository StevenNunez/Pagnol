import type { MetadataRoute } from 'next';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.pagnol.cl';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: APP_URL,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: `${APP_URL}/pricing`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${APP_URL}/demo`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${APP_URL}/register`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    {
      url: `${APP_URL}/login`,
      lastModified: new Date(),
      changeFrequency: 'yearly',
      priority: 0.3,
    },
  ];
}
