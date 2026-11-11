// AUTONEXIS Service Worker - Branded Offline & Fresh Shell Guard
const CACHE_NAME = 'autonexis-v20261111-app-v2';

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/brand/logo-mark.png',
  '/brand/logo-full.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/apple-touch-icon.png',
  '/fonts/michroma-latin-400.woff2',
  '/fonts/inter-latin.woff2',
  '/fonts/noto-sans-devanagari-dev.woff2',
  '/fonts/noto-sans-devanagari-latin.woff2'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
          return Promise.resolve();
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // 1. NEVER cache non-GET, API endpoints, or cross-origin requests
  if (
    request.method !== 'GET' ||
    url.pathname.startsWith('/api') ||
    url.origin !== self.location.origin
  ) {
    event.respondWith(fetch(request));
    return;
  }

  // 2. Navigation requests & index.html: Network-First with offline cache fallback
  const isNavigation = request.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('/index.html');
  if (isNavigation) {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (!networkResponse || networkResponse.status !== 200 || networkResponse.type === 'opaque') {
            return networkResponse;
          }
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseToCache);
          });
          return networkResponse;
        })
        .catch(async () => {
          const cachedResponse = await caches.match(request);
          if (cachedResponse) return cachedResponse;
          return caches.match('/index.html');
        })
    );
    return;
  }

  // 3. Fonts, Brand Images, Icons & Built Assets: Cache-First + background refresh
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const fetchPromise = fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type !== 'opaque') {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});

// Purge cache on account logout
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'PURGE_USER_CACHE') {
    caches.keys().then((keys) => {
      return Promise.all(keys.map((key) => caches.delete(key)));
    });
  }
});
