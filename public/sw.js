/* eslint-disable no-restricted-globals */

const CACHE_NAME = 'govrp-cache-v1';
const CACHEABLE_DESTINATIONS = new Set(['script', 'style', 'image', 'font', 'manifest']);
const CACHEABLE_EXTENSIONS = /\.(?:js|css|png|jpg|jpeg|webp|gif|avif|svg|ico|woff2?|ttf|eot|json|webmanifest)$/i;

const isCacheableRequest = (request) => {
  if (request.method !== 'GET') {
    return false;
  }

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    return false;
  }

  if (request.destination === 'document') {
    return false;
  }

  if (CACHEABLE_DESTINATIONS.has(request.destination)) {
    return true;
  }

  return CACHEABLE_EXTENSIONS.test(url.pathname);
};

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (!isCacheableRequest(event.request)) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && response.type === 'basic') {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request).then((response) => {
          return response || new Response("Você está offline.", { status: 503, statusText: "Service Unavailable" });
        });
      })
  );
});
