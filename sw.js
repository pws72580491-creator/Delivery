const CACHE_NAME = 'delivery-pro-v95';
const ASSETS = [
  '/',
  '/index.html',
  '/app.js',
  '/style.css',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
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
  // Firebase, 폰트, CDN 등 외부 요청은 네트워크 우선
  if (!e.request.url.startsWith(self.location.origin)) {
    return;
  }
  // Stale-While-Revalidate: 캐시로 즉시 응답 + 백그라운드에서 캐시 갱신
  // → 구버전에 갇히는 문제 해소 (다음 방문 시 최신 파일 제공)
  e.respondWith(
    caches.open(CACHE_NAME).then(cache =>
      cache.match(e.request).then(cached => {
        const networkFetch = fetch(e.request).then(res => {
          if (res.ok) cache.put(e.request, res.clone());
          return res;
        }).catch(() => cached); // 네트워크 실패 시 캐시 폴백
        return cached || networkFetch; // 캐시 있으면 즉시 반환, 없으면 네트워크 대기
      })
    )
  );
});
