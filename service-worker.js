/* Lubayd SA V22.4.1 - reset.html protegido y navegación offline */
const CACHE_NAME = 'lubayd-sa-v22.4.1-offline-online';
const SCOPE_URL = self.registration.scope;
const INDEX_URL = new URL('./index.html', SCOPE_URL).href;
const ROOT_URL = new URL('./', SCOPE_URL).href;
const RESET_URL = new URL('./reset.html', SCOPE_URL).href;

const APP_SHELL = [
  './', './index.html', './reset.html',
  './styles.css?v=22.4.0', './config.js?v=22.4.0', './core.js?v=22.4.0',
  './offline-db.js?v=22.4.0', './firebase-init.js?v=22.4.0', './data.js?v=22.4.0',
  './auth.js?v=22.4.0', './evidence.js?v=22.4.0', './parts.js?v=22.4.0',
  './attendance.js?v=22.4.0', './breaks.js?v=22.4.0', './fuel.js?v=22.4.0',
  './chat.js?v=22.4.0', './admin.js?v=22.4.0', './push-notifications.js?v=22.4.0',
  './app.js?v=22.4.0', './manifest.webmanifest?v=22.4.0',
  './assets/icon-192.png?v=22.4.0', './assets/icon-512.png?v=22.4.0'
];

async function fetchWithTimeout(request, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(request, { signal: controller.signal, cache: 'no-store' });
  } finally {
    clearTimeout(timer);
  }
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    for (const relativeUrl of APP_SHELL) {
      try {
        const absoluteUrl = new URL(relativeUrl, SCOPE_URL).href;
        const request = new Request(absoluteUrl, { cache: 'reload', credentials: 'same-origin' });
        const response = await fetchWithTimeout(request, 10000);
        if (response.ok) await cache.put(request, response.clone());
      } catch (error) {
        console.warn('[Lubayd SW] No se pudo precargar:', relativeUrl);
      }
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  const isResetPage = url.href === RESET_URL || url.pathname.endsWith('/reset.html');

  // reset.html jamás debe convertirse en index.html.
  if (isResetPage) {
    event.respondWith((async () => {
      try {
        const response = await fetchWithTimeout(event.request, 8000);
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(RESET_URL, response.clone());
          return response;
        }
      } catch (_) {}

      return (await caches.match(RESET_URL, { ignoreSearch: true })) ||
        new Response('No se encontró reset.html. Subilo a la raíz del repositorio.', {
          status: 404,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
    })());
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const network = await fetchWithTimeout(event.request, 4000);
        if (network.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(INDEX_URL, network.clone());
          return network;
        }
      } catch (_) {}

      return (await caches.match(INDEX_URL, { ignoreSearch: true })) ||
             (await caches.match(ROOT_URL, { ignoreSearch: true })) ||
             Response.error();
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(event.request, { ignoreSearch: true });
    if (cached) {
      event.waitUntil(fetch(event.request).then(async response => {
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(event.request, response.clone());
        }
      }).catch(() => {}));
      return cached;
    }

    try {
      const response = await fetchWithTimeout(event.request, 6000);
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(event.request, response.clone());
      }
      return response;
    } catch (_) {
      return Response.error();
    }
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'CLEAR_CACHE') {
    event.waitUntil(caches.keys().then(keys => Promise.all(keys.map(key => caches.delete(key)))));
  }
});
