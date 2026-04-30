// 납품 관리 Pro - Service Worker v75
const CACHE = 'delivery-pro-v75';
const OFFLINE_ASSETS = ['./', './index.html', './style.css', './app.js'];

self.addEventListener('install', e => {
    e.waitUntil(caches.open(CACHE).then(c => c.addAll(OFFLINE_ASSETS)));
    self.skipWaiting();
});
self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});
self.addEventListener('fetch', e => {
    const url = e.request.url;
    if (url.includes('firebaseio.com') || url.includes('googleapis.com') ||
        url.includes('gstatic.com') || url.includes('cdnjs.cloudflare.com')) {
        e.respondWith(fetch(e.request).catch(() => new Response('', {status:503})));
        return;
    }
    e.respondWith(
        caches.match(e.request).then(cached => {
            if (cached) return cached;
            return fetch(e.request).then(res => {
                if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
                return res;
            }).catch(() => caches.match('./index.html'));
        })
    );
});
