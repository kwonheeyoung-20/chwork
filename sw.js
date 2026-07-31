// 창현 Dashboard — 서비스워커 (앱 설치 가능 + 오프라인 대응)
//
// 중요: 캐싱은 "인사관리(hr.html) 앱 전용 파일들"에만 적용됩니다.
// 기업손익분석 등 다른 페이지는 이 서비스워커가 건드리지 않고
// 항상 네트워크로 그대로 흘려보냅니다 (캐시로 인한 오류 방지).

const CACHE_VERSION = 'chwork-v2'; // 버전 올려서 예전에 잘못 캐시된 것들 전부 정리
const APP_SHELL = [
  '/hr.html',
  '/manifest.json',
  '/offline.html',
  '/assets/styles.css',
  '/assets/hr.css',
  '/assets/hr.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// 이 서비스워커가 관여할 경로인지 확인 (그 외 경로는 그냥 통과)
function isManagedPath(pathname) {
  if (pathname === '/hr.html' || pathname === '/manifest.json' || pathname === '/offline.html') return true;
  if (pathname.startsWith('/assets/hr.') || pathname.startsWith('/assets/styles.css')) return true;
  if (pathname.startsWith('/icons/')) return true;
  return false;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== 'GET') return; // POST/PATCH/DELETE는 그대로 네트워크로
  if (url.pathname.startsWith('/api/')) return; // API는 항상 네트워크로만

  // hr.html 앱 전용 경로가 아니면 이 서비스워커는 아예 관여하지 않음
  // (기업손익분석 등 다른 페이지가 캐시 문제로 깨지는 것 방지)
  if (!isManagedPath(url.pathname) && req.mode !== 'navigate') {
    return;
  }
  if (req.mode === 'navigate' && url.pathname !== '/hr.html' && url.pathname !== '/') {
    return; // hr.html이 아닌 다른 페이지로 이동하는 건 그냥 네트워크로 정상 처리
  }

  // 페이지 이동(hr.html): 네트워크 우선, 실패시 캐시 → offline.html
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const resClone = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(req, resClone));
          }
          return res;
        })
        .catch(() =>
          caches.match(req).then((cached) => cached || caches.match('/offline.html'))
        )
    );
    return;
  }

  // 그 외 관리 대상 정적 자산: 캐시 우선, 없으면 네트워크 후 캐시에 저장 (성공 응답만 캐시)
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const resClone = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(req, resClone));
          }
          return res;
        })
        .catch(() => cached);
    })
  );
});
