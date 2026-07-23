/* Lubayd SA V22.0.0 - PWA offline estable */
const CACHE_NAME = 'lubayd-sa-v22.0.0-completo';
const SCOPE_URL = self.registration.scope;
const INDEX_URL = new URL('./index.html', SCOPE_URL).href;
const ROOT_URL = new URL('./', SCOPE_URL).href;
const APP_SHELL = [
  './', './index.html', './reset.html', './styles.css?v=22.0.0', './config.js?v=22.0.0', './core.js?v=22.0.0',
  './offline-db.js?v=22.0.0', './firebase-init.js?v=22.0.0', './data.js?v=22.0.0', './auth.js?v=22.0.0',
  './parts.js?v=22.0.0', './attendance.js?v=22.0.0', './breaks.js?v=22.0.0', './fuel.js?v=22.0.0',
  './chat.js?v=22.0.0', './admin.js?v=22.0.0', './push-notifications.js?v=22.0.0', './app.js?v=22.0.0',
  './manifest.webmanifest?v=22.0.0', './assets/lubayd-logo.png?v=22.0.0',
  './assets/icon-192.png?v=22.0.0', './assets/icon-512.png?v=22.0.0',
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore-compat.js',
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-functions-compat.js',
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(APP_SHELL.map(async url => {
      try {
        const absoluteUrl = url.startsWith('http') ? url : new URL(url, SCOPE_URL).href;
        const request = new Request(absoluteUrl, { cache: 'reload', mode: url.startsWith('http') ? 'no-cors' : 'same-origin' });
        const response = await fetch(request);
        if (response.ok || response.type === 'opaque') await cache.put(request, response);
      } catch (error) {
        console.warn('[Lubayd SW] No se pudo precargar:', url, error?.message || error);
      }
    }));
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
  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const network = await fetch(event.request);
        const appNavigation = url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');
        if (network.ok && appNavigation) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(INDEX_URL, network.clone());
        }
        return network;
      } catch (_) {
        return (await caches.match(INDEX_URL, { ignoreSearch: true })) || (await caches.match(ROOT_URL, { ignoreSearch: true })) || Response.error();
      }
    })());
    return;
  }
  const localOrFirebaseSdk = url.origin === self.location.origin || url.hostname === 'www.gstatic.com';
  if (!localOrFirebaseSdk) return;
  event.respondWith((async () => {
    const cached = await caches.match(event.request, { ignoreSearch: url.origin === self.location.origin });
    if (cached) {
      event.waitUntil(fetch(event.request).then(async response => {
        if (response.ok || response.type === 'opaque') {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(event.request, response.clone());
        }
      }).catch(() => {}));
      return cached;
    }
    try {
      const response = await fetch(event.request);
      if (response.ok || response.type === 'opaque') {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(event.request, response.clone());
      }
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

try {
  importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');
  if (!firebase.apps.length) firebase.initializeApp({
    apiKey: 'AIzaSyCQDwcbAox4QEDe_czZX_YSd9jVx9g5BkY',
    authDomain: 'lubayd-sa.firebaseapp.com',
    projectId: 'lubayd-sa',
    storageBucket: 'lubayd-sa.firebasestorage.app',
    messagingSenderId: '916029913982',
    appId: '1:916029913982:web:cc4e5b02b8b8055171d12f'
  });
  const messaging = firebase.messaging();
  messaging.onBackgroundMessage(payload => {
    const data = payload?.data || {};
    return self.registration.showNotification(data.title || 'Lubayd SA', {
      body: data.body || data.text || 'Tienes un mensaje nuevo.',
      icon: new URL('./assets/icon-192.png', self.registration.scope).href,
      badge: new URL('./assets/icon-192.png', self.registration.scope).href,
      tag: data.chatId ? `lubayd-chat-${data.chatId}` : 'lubayd-notification',
      renotify: true,
      vibrate: [180, 80, 180],
      data: { url: data.url || './?view=chat', chatId: data.chatId || '' }
    });
  });
} catch (error) {
  console.warn('[Lubayd SW] Firebase Messaging no disponible:', error?.message || error);
}
