/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    // Solo hosts realmente usados con next/image. NO agregar hosts "por si acaso":
    // cada patrón amplía la superficie del Image Optimizer (vector de DoS/costo).
    remotePatterns: [
      {
        // Supabase Storage — uploads (damage photos, KYC images, PDFs).
        // Único host remoto: las fotos de activos salen de aquí; los activos sin
        // foto muestran un placeholder local (ícono), no una imagen remota.
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
  // Security headers base. CSP completa se deja para una fase posterior
  // (requiere inventariar inline scripts de Next + websockets Supabase + Gemini).
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          // Nadie puede embeber Pagnol en un iframe (clickjacking del login)
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // HTTPS forzado 2 años, incluye subdominios
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          // La app SÍ usa cámara (biometría/QR) y geolocalización (geofence): solo self
          { key: 'Permissions-Policy', value: 'camera=(self), geolocation=(self), microphone=()' },
        ],
      },
    ];
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
    '/api/work-orders/**': [
      './src/lib/report-engine/**',
      './node_modules/@sparticuz/chromium/bin/**',
    ],
    '/api/work-weekly-reports/**': [
      './src/lib/report-engine/**',
      './node_modules/@sparticuz/chromium/bin/**',
    ],
  },
};

module.exports = nextConfig;
