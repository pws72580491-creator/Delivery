const CACHE_NAME = 'delivery-pro-v171';
// ★ v164: 외부 CDN 스크립트(Firebase / xlsx / html2canvas)는 버전이 URL에 박혀 있어 내용이 바뀌지 않으므로 별도 캐시에 보관.
//   예전엔 SW가 외부 요청을 전혀 캐시하지 않아, 브라우저 HTTP 캐시가 비워진 상태에서 오프라인으로 앱을 열면
//   Firebase SDK가 로드되지 않았다. 앱 버전이 바뀌어도 지워지지 않도록 CACHE_NAME과 분리했다.
//   (index.html의 CDN 주소를 바꾸면 아래 목록도 같이 바꾸되, 목록에 없어도 런타임에 자동으로 캐시됨)
const CDN_CACHE = 'delivery-pro-cdn-v1';
const CDN_HOSTS = ['cdnjs.cloudflare.com', 'www.gstatic.com'];
const CDN_PRELOAD = [
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  'https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/9.22.0/firebase-database-compat.js',
];
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
  e.waitUntil(Promise.all([
    caches.open(CACHE_NAME).then(cache =>
      Promise.all(ASSETS.map(path =>
        fetch(path, { cache: 'reload' }).then(res => {
          if (!res.ok) throw new Error(`설치 중 자산 요청 실패: ${path} (${res.status})`);
          return cache.put(path, res);
        })
      ))
    ),
    // ★ v164: CDN 스크립트 미리 보관 — 실패해도(오프라인 설치 등) 설치 자체는 막지 않는다
    caches.open(CDN_CACHE).then(cache =>
      Promise.all(CDN_PRELOAD.map(u =>
        cache.match(u).then(hit => hit || fetch(u, { mode: 'cors', credentials: 'omit' }).then(res => res.ok ? cache.put(u, res) : null))
          .catch(() => null)
      ))
    ),
  ]));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME && k !== CDN_CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // POST / non-GET 요청은 캐시 대상 아님
  if (e.request.method !== 'GET') return;

  // ★ v164: 외부 요청 — 허용된 CDN의 .js 파일만 cache-first로 처리, 나머지(Firebase 소켓/REST 등)는 SW가 관여하지 않음
  if (!e.request.url.startsWith(self.location.origin)) {
    let ext; try { ext = new URL(e.request.url); } catch (_) { return; }
    if (CDN_HOSTS.includes(ext.hostname) && ext.pathname.endsWith('.js')) {
      e.respondWith((async () => {
        const cache = await caches.open(CDN_CACHE);
        const hit = await cache.match(e.request.url);
        if (hit) return hit;
        try {
          // CORS로 받아야 상태 코드를 확인할 수 있어 오류 응답이 캐시에 박히지 않음
          const res = await fetch(e.request.url, { mode: 'cors', credentials: 'omit' });
          if (res.ok) cache.put(e.request.url, res.clone());
          return res;
        } catch (_) {
          return fetch(e.request); // CORS 미지원 등: 원래 요청 그대로 (캐시하지 않음)
        }
      })());
    }
    return;
  }

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
