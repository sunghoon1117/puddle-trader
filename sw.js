const V = 'dv-v4';   // 앱 파일이 바뀌면 이 값이 바뀌어 새 서비스 워커로 교체되고, 열려 있는 앱이 자동으로 새로고침됨
const SHELL = ['./', 'index.html', 'guide.html', 'styles.css', 'app.js', 'engine.js', 'bt-worker.js', 'knowledge.js', 'manifest.webmanifest', 'icon.svg'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// 앱 셸: 네트워크 우선(항상 최신 코드) → 실패 시 캐시(오프라인에서도 실행). 시세·API는 앱이 직접 관리(IndexedDB)하므로 건드리지 않음.
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/') || u.pathname.includes('/data/')) return;
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const cp = r.clone(); caches.open(V).then(c => c.put(e.request, cp)); } return r; })
    .catch(() => caches.match(e.request).then(m => m || caches.match('index.html'))));
});
self.addEventListener('notificationclick', e => { e.notification.close(); e.waitUntil(self.clients.matchAll({ type: 'window' }).then(l => l.length ? l[0].focus() : self.clients.openWindow('./'))); });
