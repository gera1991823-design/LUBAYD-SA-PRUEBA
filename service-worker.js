/* Lubayd SA V21.0.1 - App shell estable para trabajo sin conexión */
const CACHE_NAME = 'lubayd-sa-v21.0.1-offline-login-fix';
const FALLBACK_PAGE = './index.html';

// Se intentan guardar uno por uno: si un módulo no existe en una edición concreta,
// la instalación del Service Worker no queda bloqueada.
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './styles.css',
  './operations.css',
  './attendance.css',
  './fuel.css',
  './firebase-init.js',
  './offline-store.js',
  './offline-auth.js',
  './push-notifications.js',
  './attendance.js',
  './charts.js',
  './chat.js',
  './operations.js',
  './fuel.js',
  './app.js',
  './manifest.json',
  './manifest.webmanifest',
  './assets/logo.png',
  './assets/logo.svg',
  './assets/logo-transparent.png',
  './assets/icon.svg',
  './assets/icon-192.png',
  './assets/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(APP_SHELL.map(async asset => {
      try {
        const request = new Request(asset, { cache: 'reload' });
        const response = await fetch(request);
        if (response.ok) await cache.put(request, response);
      } catch (error) {
        console.warn('[Lubayd SW] No se precargó:', asset, error?.message || error);
      }
    }));
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

  // Navegación: red primero y, si no hay señal, index.html desde caché.
  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(event.request);
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(FALLBACK_PAGE, response.clone());
        }
        return response;
      } catch (_) {
        return (await caches.match(FALLBACK_PAGE)) || (await caches.match('./')) || Response.error();
      }
    })());
    return;
  }

  // Archivos locales: caché primero, red como actualización.
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cached = await caches.match(event.request, { ignoreSearch: true });
      const networkPromise = fetch(event.request).then(async response => {
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(event.request, response.clone());
        }
        return response;
      }).catch(() => null);
      return cached || (await networkPromise) || Response.error();
    })());
  }
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'CLEAR_LUBAYD_CACHE') {
    event.waitUntil(caches.keys().then(keys => Promise.all(keys.map(key => caches.delete(key)))));
  }
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const rawTarget = event.notification.data?.url || './?view=chat';
  const targetUrl = new URL(rawTarget, self.registration.scope).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    const existing = clients.find(client => client.url.startsWith(self.registration.scope));
    if (existing) {
      existing.navigate(targetUrl).catch(() => {});
      return existing.focus();
    }
    return self.clients.openWindow(targetUrl);
  }));
});
