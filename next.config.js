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
          // ── CSP en ENFORCEMENT (2026-08-03) ──────────────────────────────
          // Estuvo en Report-Only desde el 2026-07-30 justamente para no activar
          // a ciegas una política que rompiera la app. Se promovió después de
          // recorrer la aplicación con un detector de `securitypolicyviolation`
          // y NO encontrar ninguna violación:
          //   · 15 rutas (públicas y del dashboard), 0 violaciones.
          //   · Y los flujos que cargan librerías pesadas, que eran el riesgo
          //     real: exportar Excel (exceljs + blob), el asistente de IA,
          //     la biometría con cámara (face-api: wasm-eval + workers) y la
          //     credencial QR. 0 violaciones en los cuatro.
          //   · El detector se validó provocando una violación deliberada de
          //     `img-src` y comprobando que la capturaba: cero hallazgos con un
          //     detector que no mide se lee igual que cero hallazgos reales.
          //
          // ⚠️ La verificación corrió en DEV. Si algo se rompiera en producción,
          // el síntoma sería un recurso que no carga (imagen, fuente, worker):
          // volver a `Content-Security-Policy-Report-Only` es revertir esta línea.
          //
          // Sigue pendiente quitar 'unsafe-inline' de script-src con nonces por
          // request vía middleware — ver PENDIENTES.md.
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              // 'unsafe-inline': Next inyecta scripts de hidratación sin nonce.
              // Quitarlo exige nonces por request vía middleware — tarea aparte.
              // 'unsafe-eval' + 'wasm-unsafe-eval': los exige @vladmandic/face-api
              // (TensorFlow.js compila kernels en runtime) para la biometría.
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'",
              // Tailwind y Radix inyectan estilos inline (animaciones, posicionamiento
              // de popovers). Sin 'unsafe-inline' se cae medio sistema de diseño.
              "style-src 'self' 'unsafe-inline'",
              // data:/blob: → previsualización de fotos y PDF generados en el cliente.
              // supabase.co → fotos de activos y logos (buckets públicos).
              // unsplash → imagen del hardware pack en la landing (ver PENDIENTES).
              "img-src 'self' data: blob: https://*.supabase.co https://images.unsplash.com",
              // next/font self-hostea Inter en el build: no hace falta gstatic.
              "font-src 'self' data:",
              // wss:// es Supabase Realtime; pwnedpasswords lo consulta el registro
              // y el cambio de clave desde el cliente (k-anonymity, no envía la clave).
              "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.pwnedpasswords.com",
              // Service worker (offline + push) y los workers de face-api.
              "worker-src 'self' blob:",
              "manifest-src 'self'",
              // Cámara para biometría y lector QR.
              "media-src 'self' blob:",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              // Redundante con X-Frame-Options, pero es la directiva moderna.
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
