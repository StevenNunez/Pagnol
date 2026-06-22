// Pagnol PWA Service Worker
//
// Estrategia Offline First (Fase 1 — app-shell):
//   - Navegaciones (HTML)      → network-first con fallback a caché (la app
//                                 carga aunque no haya señal en terreno).
//   - Assets /_next/static/*   → cache-first (chunks con hash, inmutables).
//   - Imágenes / íconos        → stale-while-revalidate.
//   - API/Supabase/Realtime    → network-only (los datos NO se cachean aquí;
//                                 la persistencia de datos vive en IndexedDB,
//                                 Fase 2+). Cachear respuestas de datos daría
//                                 información obsoleta.
//
// Sube CACHE_VERSION en cada cambio de esta estrategia para invalidar cachés
// viejas en el `activate`.

const CACHE_VERSION = 'v1';
const STATIC_CACHE = `pagnol-static-${CACHE_VERSION}`;
const PAGES_CACHE = `pagnol-pages-${CACHE_VERSION}`;
const IMAGES_CACHE = `pagnol-images-${CACHE_VERSION}`;
const CURRENT_CACHES = [STATIC_CACHE, PAGES_CACHE, IMAGES_CACHE];

// Fallback de navegación: la última página de dashboard servida desde caché.
const OFFLINE_FALLBACK_URL = '/dashboard';

self.addEventListener('install', () => {
  // No se auto-activa: queda "waiting" para que la app avise al usuario
  // ("Nueva versión disponible") y solo entonces se active (SKIP_WAITING).
  // En la primera instalación no hay controlador previo, así que la app no
  // muestra aviso y el SW toma control en el `activate`.
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Limpia cachés de versiones anteriores.
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith('pagnol-') && !CURRENT_CACHES.includes(key))
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

// --- Helpers de estrategia ---------------------------------------------------

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => undefined);
  return cached || (await network) || Response.error();
}

async function networkFirstNavigation(request) {
  const cache = await caches.open(PAGES_CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    // Sin red: intenta la página exacta y, si no, el shell del dashboard.
    const cached = await cache.match(request);
    if (cached) return cached;
    const fallback = await cache.match(OFFLINE_FALLBACK_URL);
    if (fallback) return fallback;
    return new Response(
      '<!doctype html><meta charset="utf-8"><title>Sin conexión</title>' +
        '<body style="font-family:system-ui;padding:2rem;text-align:center">' +
        '<h1>Sin conexión</h1><p>Abre la app con internet al menos una vez para usarla offline.</p></body>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Solo GET; el resto (POST/PATCH a Supabase) pasa directo a la red.
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  // Solo manejamos peticiones de nuestro propio origen.
  if (url.origin !== self.location.origin) return;

  // Nunca cacheamos datos/funciones server: API propia y endpoints de Supabase
  // (cuando pasan por el mismo origen). Realtime usa websockets (no GET).
  if (url.pathname.startsWith('/api/')) return;

  // Navegaciones (carga de páginas).
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  // Assets estáticos de Next (hash inmutable).
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // Imágenes e íconos.
  if (
    request.destination === 'image' ||
    /\.(?:png|jpg|jpeg|gif|svg|webp|ico)$/i.test(url.pathname)
  ) {
    event.respondWith(staleWhileRevalidate(request, IMAGES_CACHE));
    return;
  }

  // Fuentes y otros estáticos cacheables.
  if (
    request.destination === 'font' ||
    request.destination === 'style' ||
    request.destination === 'script'
  ) {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
    return;
  }
});

// --- Background Sync ---------------------------------------------------------
// El SW no tiene la sesión de Supabase (vive en localStorage de la página), así
// que no puede subir la cola por sí mismo con la app cerrada. Lo que sí puede:
// al recuperar conexión en segundo plano, pedir a las pestañas abiertas que
// ejecuten la sincronización. Cubre el caso "pestaña en background".

self.addEventListener('sync', (event) => {
  if (event.tag !== 'pagnol-sync') return;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        client.postMessage({ type: 'pagnol-sync' });
      }
    })
  );
});

// --- Push (preservado del SW original) --------------------------------------

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    data = { title: 'Pagnol', body: event.data.text() };
  }

  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || 'pagnol-notification',
    data: { url: data.url || '/dashboard/pagnol' },
    requireInteraction: data.requireInteraction || false,
    actions: data.actions || [],
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'Pagnol', options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/dashboard/pagnol';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
