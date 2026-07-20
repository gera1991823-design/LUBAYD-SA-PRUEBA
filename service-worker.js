/* Lubayd SA V18 - PWA + Firebase Cloud Messaging */

// Este listener debe registrarse antes de importar Firebase Messaging para conservar
// el comportamiento personalizado al tocar una notificación.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const rawTarget = event.notification.data?.url || './?view=chat';
  const targetUrl = new URL(rawTarget, self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const existing = clients.find(client => client.url.startsWith(self.registration.scope));
      if (existing) {
        existing.navigate(targetUrl).catch(() => {});
        return existing.focus();
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});

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

const CACHE_NAME = 'lubayd-forestal-v18.0.0-push';
const LOCAL_ASSETS = [
  './',
  './index.html',
  './style.css',
  './operations.css',
  './attendance.css',
  './app.js',
  './charts.js',
  './chat.js',
  './operations.js',
  './attendance.js',
  './firebase-init.js',
  './push-notifications.js',
  './manifest.json',
  './assets/logo.png',
  './assets/logo-transparent.png',
  './assets/icon-192.png',
  './assets/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(LOCAL_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      const network = fetch(event.request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
