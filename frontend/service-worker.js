// Service Worker for yt-Downloader
// Strategy: Network-first for code assets (HTML/CSS/JS), cache-first for static media
// Cache versioning: bump CACHE_VERSION on each deployment to force cache refresh

const CACHE_PREFIX = 'app-cache';
const CACHE_VERSION = 'v1';
const CURRENT_CACHE = `${CACHE_PREFIX}-${CACHE_VERSION}`;

const PRECACHE_URLS = [
    '/',
    '/index.html',
    '/styles.css',
    '/app.js',
    '/manifest.json',
    '/icons/icon-192.svg',
    '/icons/icon-512.svg'
];

// Detect if a request is for a code asset that should use network-first strategy
function isCodeAsset(url) {
    const path = url.pathname;
    return path === '/' ||
        path === '/index.html' ||
        path.endsWith('.html') ||
        path.endsWith('.css') ||
        path.endsWith('.js');
}

// Detect if a request is for a static media/asset that can use cache-first
function isStaticAsset(url) {
    const path = url.pathname;
    return path.startsWith('/icons/') ||
        path === '/manifest.json' ||
        path.endsWith('.svg') ||
        path.endsWith('.png') ||
        path.endsWith('.jpg') ||
        path.endsWith('.jpeg') ||
        path.endsWith('.gif') ||
        path.endsWith('.webp') ||
        path.endsWith('.ico') ||
        path.endsWith('.woff') ||
        path.endsWith('.woff2') ||
        path.endsWith('.ttf') ||
        path.endsWith('.eot');
}

// ---- INSTALL ----
self.addEventListener('install', (event) => {
    console.log('[SW] Installing version:', CACHE_VERSION);
    event.waitUntil(
        caches.open(CURRENT_CACHE).then((cache) => {
            return cache.addAll(PRECACHE_URLS).catch((err) => {
                console.warn('[SW] Pre-cache failed for some URLs:', err);
                // Don't fail the install for pre-cache errors
            });
        }).then(() => {
            // Activate immediately — don't wait for page reload
            return self.skipWaiting();
        })
    );
});

// ---- ACTIVATE ----
self.addEventListener('activate', (event) => {
    console.log('[SW] Activating version:', CACHE_VERSION);
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            const validPrefix = `${CACHE_PREFIX}-`;
            return Promise.all(
                cacheNames
                .filter((name) => {
                    // Delete any cache that starts with our prefix but is NOT the current version
                    return name.startsWith(validPrefix) && name !== CURRENT_CACHE;
                })
                .map((oldCache) => {
                    console.log('[SW] Deleting old cache:', oldCache);
                    return caches.delete(oldCache);
                })
            );
        }).then(() => {
            // Take control of all clients immediately
            return self.clients.claim();
        }).then(() => {
            // Notify all active clients that a new version is installed
            return self.clients.matchAll().then((clients) => {
                clients.forEach((client) => {
                    client.postMessage({
                        type: 'SW_VERSION_ACTIVATED',
                        version: CACHE_VERSION
                    });
                });
            });
        })
    );
});

// ---- FETCH ----
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Same-origin check: only handle our own requests
    if (url.origin !== self.location.origin) {
        // Cross-origin (e.g. YouTube thumbnails) — pass through without caching
        event.respondWith(fetch(event.request));
        return;
    }

    // ---- NEVER CACHE: API calls ----
    if (
        url.pathname.startsWith('/api/') ||
        url.pathname.startsWith('/healthz')
    ) {
        event.respondWith(fetch(event.request));
        return;
    }

    // ---- CODE ASSETS: Network-first, fallback to cache ----
    // HTML, CSS, JS files — always try network first so users see latest code
    if (isCodeAsset(url)) {
        event.respondWith(networkFirstWithCache(event.request));
        return;
    }

    // ---- STATIC MEDIA: Cache-first, fallback to network ----
    // Icons, fonts, manifest — keep cached for performance
    if (isStaticAsset(url)) {
        event.respondWith(cacheFirstWithNetworkFallback(event.request));
        return;
    }

    // ---- EVERYTHING ELSE: Network-only ----
    // e.g. remote URLs, blob URLs, etc.
    event.respondWith(fetch(event.request).catch(() => {
        return new Response('Offline', { status: 503 });
    }));
});

/**
 * Network-first strategy:
 * 1. Try fetching from network
 * 2. On success, update the cache with the fresh response
 * 3. On failure (offline/server error), serve the cached version
 */
async function networkFirstWithCache(request) {
    try {
        const networkResponse = await fetch(request);

        // Only cache successful GET responses for same-origin requests
        if (
            networkResponse &&
            networkResponse.status === 200 &&
            networkResponse.type === 'basic'
        ) {
            const responseToCache = networkResponse.clone();
            caches.open(CURRENT_CACHE).then((cache) => {
                cache.put(request, responseToCache);
            });
        }

        return networkResponse;
    } catch (err) {
        // Network failed — try cache
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
            console.log('[SW] Serving from cache (network failed):', request.url);
            return cachedResponse;
        }

        // Nothing in cache either — return a fallback
        if (request.headers.get('Accept') && request.headers.get('Accept').includes('text/html')) {
            return new Response('You are offline and the page is not cached.', {
                status: 503,
                headers: { 'Content-Type': 'text/html' }
            });
        }

        return new Response('Offline', { status: 503 });
    }
}

/**
 * Cache-first strategy:
 * 1. Serve from cache immediately (fast)
 * 2. Fetch from network in background to update cache for next time
 * 3. If cache miss, fallback to network
 */
async function cacheFirstWithNetworkFallback(request) {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
        // Background-refresh the cache (fire-and-forget)
        fetch(request).then((networkResponse) => {
            if (
                networkResponse &&
                networkResponse.status === 200 &&
                networkResponse.type === 'basic'
            ) {
                const responseToCache = networkResponse.clone();
                caches.open(CURRENT_CACHE).then((cache) => {
                    cache.put(request, responseToCache);
                });
            }
        }).catch(() => {
            // Network fetch failed — cached version is fine
        });

        return cachedResponse;
    }

    // Nothing in cache — fetch from network
    try {
        const networkResponse = await fetch(request);
        if (
            networkResponse &&
            networkResponse.status === 200 &&
            networkResponse.type === 'basic'
        ) {
            const responseToCache = networkResponse.clone();
            caches.open(CURRENT_CACHE).then((cache) => {
                cache.put(request, responseToCache);
            });
        }
        return networkResponse;
    } catch (err) {
        return new Response('Offline', { status: 503 });
    }
}