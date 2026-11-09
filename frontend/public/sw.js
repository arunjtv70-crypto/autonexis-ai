// AUTONEXIS Service Worker - Hardened Version
const CACHE_NAME = 'autonexis-v20261110-guard';

self.addEventListener('install', (event) => {
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
    })
    .then(() => self.clients.claim())
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

  // 2. Navigation requests & index.html: Strict Network-First
  // Ensures user always receives latest HTML containing up-to-date asset chunk hashes
  const isNavigation = request.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('/index.html');
  if (isNavigation) {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          // Never cache failed responses (status >= 400) or opaque errors
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
          // Fallback to cached index.html only when strictly offline
          const cachedResponse = await caches.match(request);
          if (cachedResponse) {
            return cachedResponse;
          }
          return caches.match('/index.html');
        })
    );
    return;
  }

  // 3. Static assets (/assets/, fonts, icons, images)
  // Stale-while-revalidate / Cache-first with error protection
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const fetchPromise = fetch(request)
        .then((networkResponse) => {
          // Only cache successful 200 responses
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
