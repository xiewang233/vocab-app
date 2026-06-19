const CACHE_NAME = 'xiewang-vocab-v3';

// Core assets to pre-cache
const PRE_CACHE = [
  '/',
  '/static/css/style.css',
  '/static/js/app.js',
  '/static/favicon.ico',
  '/static/icons/icon-192.png',
  '/static/icons/icon-512.png',
  '/static/icons/apple-touch-icon.png',
  '/static/manifest.json'
];

// Word data (cached on first use)
const WORD_FILES = [
  '/data/words/cet4.json',
  '/data/words/cet6.json',
  '/data/words/kaoyan.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(PRE_CACHE).catch(err => {
        console.warn('Pre-cache partial failure:', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Cache-first for word data
  if (WORD_FILES.some(f => url.pathname.endsWith(f) || url.pathname === f)) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Cache-first for static assets
  if (url.pathname.startsWith('/static/') ||
      url.pathname === '/' ||
      url.pathname === '/sw.js' ||
      url.pathname === '/manifest.json') {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Everything else: network-first
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
