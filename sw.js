const CACHE_NAME = 'delivery-pro-v131';
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
  // ★ v129 fix: cache.addAll()의 기본 fetch는 브라우저 HTTP 캐시로 응답이 충족될 수 있음 —
  // 즉 SW 자체는 새로 설치돼도, 그 안에 채워 넣는 내용이 여전히 브라우저 HTTP 캐시에 남아있던
  // "옛 버전" 바이트일 수 있음 (SW 입장에선 알 방법이 없음). cache:'reload'로 HTTP 캐시를
  // 완전히 건너뛰고 매번 네트워크에서 진짜 새 파일을 받아오도록 강제.
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.all(ASSETS.map(path =>
        fetch(path, { cache: 'reload' }).then(res => {
          if (!res.ok) throw new Error(`설치 중 자산 요청 실패: ${path} (${res.status})`);
          return cache.put(path, res);
        })
      ))
    )
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
          // ★ v127 fix (리뷰 중 발견): cached는 바로 아래에서 그대로 반환되어 브라우저가
          // 곧장 body를 소비하기 시작함. 그 뒤 fetch().then() 콜백(네트워크 왕복 후, 항상 더 늦게 실행)에서
          // cached.clone()을 호출하면 "body already used"로 예외가 나고, 그게 .catch(()=>{})에
          // 조용히 삼켜져서 비교 로직 자체가 사실상 죽어있게 됨. body가 아직 손대지지 않은
          // 지금 시점에 미리 clone해서 비교용으로 따로 들고 있어야 함.
          const cachedForCompare = cached ? cached.clone() : null;

          // 백그라운드 갱신 (stale-while-revalidate)
          // ★ v129 fix: 여기도 install과 동일한 이유로 cache:'reload' 필요 —
          // 아니면 "새 버전 확인용" 재검증 fetch 자체가 브라우저 HTTP 캐시로 조용히
          // 충족되어 버려서, 서버에 진짜 새 파일이 올라가 있어도 영원히 감지를 못 함.
          const revalidate = fetch(e.request, { cache: 'reload' }).then(res => {
            if (res.ok) {
              const isAppScript = url.pathname.endsWith('.js') || url.pathname.endsWith('.css');
              // ★ v127 fix: 재검증 성공 = "네트워크 응답 받음"일 뿐, 내용이 바뀌었다는 뜻이 아님.
              // 예전엔 매번 성공할 때마다(즉, 앱을 열 때마다) 무조건 알림을 보내서
              // 실제로는 새 버전이 없어도 "새 버전이 준비되었습니다" 배너가 계속 재표시됐음.
              // 캐시된 내용과 실제로 달라졌을 때만 클라이언트에 알림.
              if (isAppScript && cachedForCompare) {
                const resForCache = res.clone();
                const resForCompare = res.clone();
                Promise.all([cachedForCompare.text(), resForCompare.text()])
                  .then(([oldText, newText]) => {
                    if (oldText !== newText) {
                      self.clients.matchAll().then(clients =>
                        clients.forEach(c => c.postMessage({ type: 'SW_UPDATED', url: url.pathname }))
                      );
                    }
                  })
                  .catch(() => {});
                cache.put(e.request, resForCache);
              } else {
                cache.put(e.request, res.clone());
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
