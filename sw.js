const CACHE_NAME = 'delivery-pro-v112';
const ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  // ── JS 모듈 ──
  '/js/state.js',
  '/js/storage.js',
  '/js/app.js',
  '/js/crm-sync.js',
  '/js/sync.js',
  '/js/core.js',
  '/js/clients.js',
  '/js/dashboard.js',
  '/js/settings.js',
  '/js/manual.js',
  '/js/form.js',
  '/js/history.js',
  '/js/settlement.js',
  '/js/stock.js',
  '/js/backup.js',
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
  // Firebase / 외부 요청은 SW가 관여하지 않음
  if (!e.request.url.startsWith(self.location.origin)) return;
  // POST / non-GET 요청은 캐시 대상 아님
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);

  // ── JS / CSS 앱 에셋: stale-while-revalidate ──
  // 캐시된 버전을 즉시 반환(빠른 로드) + 백그라운드에서 최신 버전으로 갱신
  const isAppAsset = ASSETS.some(a => url.pathname === a || url.pathname.endsWith(a));
  if (isAppAsset) {
    e.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        cache.match(e.request).then(cached => {
          // 백그라운드 갱신 (stale-while-revalidate)
          const revalidate = fetch(e.request).then(res => {
            if (res.ok) {
              cache.put(e.request, res.clone());
              // ★ JS 파일이 갱신되면 모든 클라이언트에 알림 → 앱이 알아서 새로고침 유도 가능
              if (url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) {
                self.clients.matchAll().then(clients =>
                  clients.forEach(c => c.postMessage({ type: 'SW_UPDATED', url: url.pathname }))
                );
              }
            }
            return res;
          }).catch(() => null);

          // 캐시 있으면 즉시 반환 (백그라운드 갱신은 계속 진행)
          if (cached) return cached;
          // 캐시 없으면 네트워크 응답 대기
          return revalidate.then(res => res || Response.error());
        })
      )
    );
    return;
  }

  // ── 그 외 오리진 요청: network-first (캐시는 폴백) ──
  e.respondWith(
    caches.open(CACHE_NAME).then(cache =>
      fetch(e.request)
        .then(res => { if (res.ok) cache.put(e.request, res.clone()); return res; })
        .catch(() => cache.match(e.request).then(c => c || Response.error()))
    )
  );
});
