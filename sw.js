// 창현 Dashboard — 최소 서비스워커 (앱 설치 가능하게 하는 용도)
// 오프라인 캐싱은 하지 않고, 그냥 네트워크로 그대로 요청을 흘려보냅니다.
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
