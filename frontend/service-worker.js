const CACHE_NAME = 'yt-downloader-v1';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/styles.css',
    '/app.js',
    '/manifest.json',
    '/icons/icon-192.svg',
    '/icons/icon-512.svg'
];

// Install: cache all static assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS);
        })
    );
    // Activate immediately without waiting for page reload
    self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys
                .filter((key) => key !== CACHE_NAME)
                .map((key) => caches.delete(key))
            );
        })
    );
    // Take control of all clients immediately
    self.clients.claim();
});

// Fetch: serve static assets from cache, always go network for API calls
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Never cache API calls, SSE endpoints, or download file requests
    if (
        url.pathname.startsWith('/api/') ||
        url.pathname.startsWith('/healthz')
    ) {
        event.respondWith(fetch(event.request));
        return;
    }

    // For static assets: cache-first, fallback to network
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
                return cachedResponse;
            }
            return fetch(event.request).then((networkResponse) => {
                // Only cache successful GET responses for our own static assets
                if (
                    networkResponse &&
                    networkResponse.status === 200 &&
                    networkResponse.type === 'basic'
                ) {
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseToCache);
                    });
                }
                return networkResponse;
            });
        })
    );
});