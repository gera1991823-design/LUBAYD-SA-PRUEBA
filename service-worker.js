/* Lubayd SA V20.4 - PWA V19 + modo offline + Firebase Cloud Messaging */
const CACHE_NAME = 'lubayd-sa-v20.4.0-v19-offline';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css?v=20.4.0',
  './firebase-init.js?v=20.4.0',
  './offline-store.js?v=20.4.0',
  './push-notifications.js?v=20.4.0',
  './attendance.js?v=20.4.0',
  './chat.js?v=20.4.0',
  './app.js?v=20.4.0',
  './manifest.webmanifest?v=20.4.0',
  './assets/logo.svg',
  './assets/icon.svg',
  './assets/icon-192.png?v=20.4.0',
  './assets/icon-512.png?v=20.4.0'
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
  // La caché y el modo offline deben seguir funcionando aunque Firebase Messaging no cargue.
  console.warn('Firebase Messaging no disponible en este momento:', error);
}


self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))));
  self.clients.claim();
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (_) {
    return (await cache.match(request, { ignoreSearch: true })) || (request.mode === 'navigate' ? cache.match('./index.html') : Response.error());
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) {
    fetch(request).then(response => {
      if (response.ok) cache.put(request, response.clone());
    }).catch(() => {});
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

  if (event.request.mode === 'navigate' || /\.(?:js|css|html|webmanifest)$/.test(url.pathname)) {
    event.respondWith(networkFirst(event.request));
    return;
  }
  if (/\.(?:png|svg|jpg|jpeg|webp)$/.test(url.pathname)) {
    event.respondWith(cacheFirst(event.request));
  }
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'CLEAR_CACHE') {
    event.waitUntil(caches.keys().then(keys => Promise.all(keys.map(key => caches.delete(key)))));
  }
});
