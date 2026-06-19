const CACHE_NAME = 'xiewang-vocab-v4';

// Core assets to pre-cache (relative paths for GitHub Pages compatibility)
const PRE_CACHE = [
  './',
  './static/css/style.css',
  './static/js/app.js',
  './static/favicon.ico',
  './static/icons/icon-192.png',
  './static/icons/icon-512.png',
  './static/icons/apple-touch-icon.png',
  './manifest.json'
];

// Word data (cached on first use)
const WORD_FILES = [
  './data/words/cet4.json',
  './data/words/cet6.json',
  './data/words/kaoyan.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(PRE_CACHE).catch(err => {
        console.warn('Pre-cache partial:', err);
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
  if (WORD_FILES.some(f => url.pathname.endsWith(f.replace('./', '/')) || url.pathname.includes(f.replace('./', '')))) {
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
  if (url.pathname.includes('/static/') ||
      url.pathname.endsWith('/sw.js') ||
      url.pathname.endsWith('/manifest.json') ||
      url.pathname === '/' || url.pathname.endsWith('/vocab-app/')) {
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

  // Network-first fallback
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
