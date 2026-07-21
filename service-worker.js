/* Lubayd SA V20.8.9 - diseño V20.1 + asistencia offline + push */
const CACHE_NAME = 'lubayd-forestal-v20.8.9-fuel-offline';
const LOCAL_ASSETS = [
  './',
  './index.html',
  './style.css?v=20.8.9',
  './operations.css?v=20.8.9',
  './attendance.css?v=20.8.9',
  './fuel.css?v=20.8.9',
  './firebase-init.js?v=20.8.9',
  './offline-store.js?v=20.8.9',
  './push-notifications.js?v=20.8.9',
  './app.js?v=20.8.9',
  './charts.js?v=20.8.9',
  './chat.js?v=20.8.9',
  './attendance.js?v=20.8.9',
  './fuel.js?v=20.8.9',
  './operations.js?v=20.8.9',
  './manifest.json?v=20.8.9',
  './assets/logo.png',
  './assets/logo-transparent.png',
  './assets/icon-192.png',
  './assets/icon-512.png'
];

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

try {
  importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');
  firebase.initializeApp({
    apiKey: 'AIzaSyCQDwcbAox4QEDe_czZX_YSd9jVx9g5BkY',
    authDomain: 'lubayd-sa.firebaseapp.com',
    projectId: 'lubayd-sa',
    storageBucket: 'lubayd-sa.firebasestorage.app',
    messagingSenderId: '916029913982',
    appId: '1:916029913982:web:cc4e5b02b8b8055171d12f',
    measurementId: 'G-LVP0TWS84N'
  });
  const messaging = firebase.messaging();
  messaging.onBackgroundMessage(payload => {
    const data = payload?.data || {};
    const title = data.title || (data.senderName ? `Nuevo mensaje de ${data.senderName}` : 'Nuevo mensaje');
    const body = data.body || data.text || 'Tienes un mensaje nuevo en Lubayd SA.';
    const url = data.url || './?view=chat';
    return self.registration.showNotification(title, {
      body,
      icon: new URL('./assets/icon-192.png', self.registration.scope).href,
      badge: new URL('./assets/icon-192.png', self.registration.scope).href,
      tag: data.chatId ? `lubayd-chat-${data.chatId}` : 'lubayd-chat',
      renotify: true,
      vibrate: [180, 90, 180],
      data: { url, chatId: data.chatId || '', senderId: data.senderId || '' }
    });
  });
} catch (error) {
  console.warn('[Lubayd SW] Firebase Messaging no disponible:', error);
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(LOCAL_ASSETS.map(async asset => {
      try { await cache.add(asset); } catch (error) { console.warn('[Lubayd SW] No se pudo precargar:', asset, error); }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))));
  self.clients.claim();
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch(request, { cache: 'no-store', signal: controller.signal });
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (_) {
    return (await cache.match(request, { ignoreSearch: true })) || (request.mode === 'navigate' ? cache.match('./index.html') : Response.error());
  } finally {
    clearTimeout(timer);
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) {
    fetch(request).then(response => { if (response.ok) cache.put(request, response.clone()); }).catch(() => {});
    return cached;
  }
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.mode === 'navigate' || /\.(?:js|css|html|json|webmanifest)$/.test(url.pathname)) {
    event.respondWith(networkFirst(event.request));
    return;
  }
  if (/\.(?:png|svg|jpg|jpeg|webp)$/.test(url.pathname)) event.respondWith(cacheFirst(event.request));
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'CLEAR_CACHE') {
    event.waitUntil(caches.keys().then(keys => Promise.all(keys.map(key => caches.delete(key)))));
  }
});
