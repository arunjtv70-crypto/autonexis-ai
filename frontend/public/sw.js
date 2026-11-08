// AUTONEXIS Service Worker - Cache Busting Version: autonexis-v20261109-privacy
const CACHE_NAME = 'autonexis-v20261109-privacy';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          return caches.delete(key);
        })
      );
    })
    .then(() => self.registration.unregister())
    .then(() => self.clients.claim())
  );
});

// NEVER cache API responses, user data, or dynamic requests
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (
    url.pathname.startsWith('/api') ||
    event.request.method !== 'GET' ||
    url.origin !== self.location.origin
  ) {
    event.respondWith(fetch(event.request));
    return;
  }
  event.respondWith(fetch(event.request));
});

// Purge cache on account logout
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'PURGE_USER_CACHE') {
    caches.keys().then((keys) => {
      return Promise.all(keys.map((key) => caches.delete(key)));
    });
  }
});
