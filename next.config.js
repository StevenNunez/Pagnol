/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        pathname: '**',
      },
      {
        protocol: 'https',
        hostname: 'i.imgur.com',
        pathname: '**',
      },
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        pathname: '**',
      },
      {
        // Supabase Storage — uploads (damage photos, KYC images, PDFs)
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
  transpilePackages: ['jspdf', 'canvg', 'core-js'],
  // Puppeteer/Chromium son paquetes con binarios: no deben bundlearse.
  serverExternalPackages: ['puppeteer-core', '@sparticuz/chromium'],
  // El motor PDF lee template.hbs + assets en runtime; inclúyelos en el
  // file-tracing de las funciones de la API de reportes (Vercel).
  // Además: aunque @sparticuz/chromium está externalizado (no se bundlea),
  // Next.js NO copia sus binarios .br (bin/chromium.br, etc.) porque no hay un
  // require() estático que los referencie. Hay que incluir bin/ explícitamente,
  // si no, en Vercel falla con "input directory .../@sparticuz/chromium/bin does not exist".
  outputFileTracingIncludes: {
    '/api/work-reports/**': [
      './src/lib/report-engine/**',
      './node_modules/@sparticuz/chromium/bin/**',
    ],
  },
};

module.exports = nextConfig;
