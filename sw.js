const CACHE_NAME = 'delivery-pro-v97a';
const ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  // ── JS 모듈 ──
  '/js/core/state.js',
  '/js/core/storage.js',
  '/js/core/app.js',
  '/js/firebase/crm-sync.js',
  '/js/firebase/sync.js',
  '/js/ui/core.js',
  '/js/ui/clients.js',
  '/js/ui/dashboard.js',
  '/js/ui/settings.js',
  '/js/ui/manual.js',
  '/js/delivery/form.js',
  '/js/delivery/history.js',
  '/js/settlement/settlement.js',
  '/js/stock/stock.js',
  '/js/utils/backup.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (!e.request.url.startsWith(self.location.origin)) {
    return;
  }
  e.respondWith(
    caches.open(CACHE_NAME).then(cache =>
      cache.match(e.request).then(cached => {
        const networkFetch = fetch(e.request).then(res => {
          if (res.ok) cache.put(e.request, res.clone());
          return res;
        }).catch(() => cached);
        return cached || networkFetch;
      })
    )
  );
});
