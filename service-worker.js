/* Lubayd SA V22.4.0 - PWA offline; no depende de scripts externos para iniciar */
const CACHE_NAME = 'lubayd-sa-v22.4.0-offline-online';
const SCOPE_URL = self.registration.scope;
const INDEX_URL = new URL('./index.html', SCOPE_URL).href;
const ROOT_URL = new URL('./', SCOPE_URL).href;
const APP_SHELL = [
  './', './index.html', './reset.html',
  './styles.css?v=22.4.0', './config.js?v=22.4.0', './core.js?v=22.4.0', './offline-db.js?v=22.4.0',
  './firebase-init.js?v=22.4.0', './data.js?v=22.4.0', './auth.js?v=22.4.0', './evidence.js?v=22.4.0',
  './parts.js?v=22.4.0', './attendance.js?v=22.4.0', './breaks.js?v=22.4.0', './fuel.js?v=22.4.0',
  './chat.js?v=22.4.0', './admin.js?v=22.4.0', './push-notifications.js?v=22.4.0', './app.js?v=22.4.0',
  './manifest.webmanifest?v=22.4.0', './assets/icon-192.png?v=22.4.0', './assets/icon-512.png?v=22.4.0'
];

async function fetchWithTimeout(request, timeoutMs = 3500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(request, { signal: controller.signal }); }
  finally { clearTimeout(timer); }
}
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    for (const url of APP_SHELL) {
      try {
        const request = new Request(new URL(url, SCOPE_URL).href, { cache: 'reload', credentials: 'same-origin' });
        const response = await fetchWithTimeout(request, 10000);
        if (response.ok) await cache.put(request, response.clone());
      } catch (error) { console.warn('[Lubayd SW] No se pudo precargar:', url); }
    }
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.toLowerCase().includes('lubayd') && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      const cached = await caches.match(INDEX_URL, { ignoreSearch: true }) || await caches.match(ROOT_URL, { ignoreSearch: true });
      try {
        const network = await fetchWithTimeout(event.request, 3000);
        if (network.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(INDEX_URL, network.clone());
          return network;
        }
      } catch (_) {}
      return cached || Response.error();
    })());
    return;
  }
  event.respondWith((async () => {
    const cached = await caches.match(event.request, { ignoreSearch: true });
    if (cached) {
      event.waitUntil(fetch(event.request).then(async response => {
        if (response.ok) (await caches.open(CACHE_NAME)).put(event.request, response.clone());
      }).catch(() => {}));
      return cached;
    }
    try {
      const response = await fetchWithTimeout(event.request, 5000);
      if (response.ok) (await caches.open(CACHE_NAME)).put(event.request, response.clone());
      return response;
    } catch (_) { return Response.error(); }
  })());
});
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'CLEAR_CACHE') event.waitUntil(caches.delete(CACHE_NAME));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || './?view=chat', self.registration.scope).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    const existing = clients.find(client => client.url.startsWith(self.registration.scope));
    if (existing) { existing.navigate(target).catch(() => {}); return existing.focus(); }
    return self.clients.openWindow(target);
  }));
});
