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
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          // ── CSP en ENFORCEMENT ───────────────────────────────────────────
          // Añadida en Report-Only el 2026-07-30 y promovida a enforcement el
          // 2026-08-03, tras recorrer la app con un detector de
          // `securitypolicyviolation` sin encontrar violaciones: 15 rutas más los
          // flujos pesados (Excel, IA, biometría con cámara, QR), y re-verificado
          // con la política ya bloqueando.
          //
          // 🔴 NO INTENTAR "quitar 'unsafe-inline' con nonces por middleware":
          // se probó el 2026-08-03 y ROMPE LA APLICACIÓN. Next sólo estampa el
          // nonce en páginas que renderiza por request, y acá 168 de 226 son
          // prerenderizadas: su HTML sale de build con los `<script>` ya escritos
          // y SIN nonce. Como `'strict-dynamic'` anula `'self'`, el navegador
          // bloquea los propios chunks de `/_next/static/` — verificado contra un
          // build de producción: 20-32 violaciones por ruta y el dashboard sin
          // hidratar (72 caracteres en pantalla).
          // Para que el nonce sirva habría que forzar TODA la app a dinámica
          // (`force-dynamic`), perdiendo el prerender: es una decisión de
          // arquitectura con costo real, no un ajuste de cabecera. Ver PENDIENTES.
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              // 'unsafe-inline': Next inyecta scripts de hidratación sin nonce y,
              // con prerender estático, no hay forma de dárselo (ver arriba).
              // 'unsafe-eval' + 'wasm-unsafe-eval': los exige @vladmandic/face-api
              // (TensorFlow.js compila kernels en runtime) para la biometría.
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'",
              // Tailwind y Radix inyectan estilos inline (animaciones, posicionamiento
              // de popovers). Sin 'unsafe-inline' se cae medio sistema de diseño.
              "style-src 'self' 'unsafe-inline'",
              // data:/blob: → previsualización de fotos y PDF generados en el cliente.
              // supabase.co → fotos de activos y logos. unsplash → landing.
              "img-src 'self' data: blob: https://*.supabase.co https://images.unsplash.com",
              "font-src 'self' data:",
              // wss:// es Supabase Realtime; pwnedpasswords lo consulta el registro
              // y el cambio de clave (k-anonymity, no envía la clave).
              "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.pwnedpasswords.com",
              // Service worker (offline + push) y los workers de face-api.
              "worker-src 'self' blob:",
              "manifest-src 'self'",
              // Cámara para biometría y lector QR.
              "media-src 'self' blob:",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'none'",
              'upgrade-insecure-requests',
            ].join('; '),
          },
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
