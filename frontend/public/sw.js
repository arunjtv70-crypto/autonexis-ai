// AUTONEXIS Service Worker - Cache Busting Version: autonexis-v20261109-7a2e7
const CACHE_NAME = 'autonexis-v20261109-7a2e7';

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

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
