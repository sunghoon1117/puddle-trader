const V = 'dv-v4';   // 앱 파일이 바뀌면 이 값이 바뀌어 새 서비스 워커로 교체되고, 열려 있는 앱이 자동으로 새로고침됨
const SHELL = ['./', 'index.html', 'guide.html', 'styles.css', 'app.js', 'detail.js', 'weekend.js', 'positions.js', 'engine.js', 'bt-worker.js', 'knowledge.js', 'manifest.webmanifest', 'icon.svg', 'icon-180.png', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => { })))).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// 앱 셸: 네트워크 우선(항상 최신 코드) → 실패 시 캐시(오프라인에서도 실행). 시세·API는 앱이 직접 관리(IndexedDB)하므로 건드리지 않음.
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/') || u.pathname.includes('/data/')) return;
  const net = fetch(e.request, { cache: 'no-cache' }).then(r => { if (r.ok) { const cp = r.clone(); caches.open(V).then(c => c.put(e.request, cp)); } return r; });   // HTTP 캐시를 우회해 항상 최신 파일 확인
  const slow = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000));   // 약한 망에서는 4초 뒤 캐시로
  e.respondWith(Promise.race([net, slow]).catch(() => caches.match(e.request, { ignoreSearch: true }).then(m => m || (e.request.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
});
self.addEventListener('notificationclick', e => { e.notification.close(); e.waitUntil(self.clients.matchAll({ type: 'window' }).then(l => l.length ? l[0].focus() : self.clients.openWindow('./'))); });
