import type { MetadataRoute } from 'next';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.pagnol.cl';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Rutas privadas/operativas: sin valor SEO y no deben indexarse.
        disallow: [
          '/dashboard',
          '/api/',
          '/enroll/',
          '/invite',
          '/auth/',
          '/reset-password',
          '/update-password',
        ],
      },
    ],
    sitemap: `${APP_URL}/sitemap.xml`,
  };
}
