/* 离线缓存：让「添加到主屏幕」后断网也能用 */
/* 注意：改了前端代码后，请把版本号 +1，否则用户可能拿到旧缓存 */
const CACHE = 'ddl-planner-v3';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './core.js',
  './state.js',
  './views.js',
  './main.js',
  './manifest.webmanifest'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS).catch(() => {}))   // 个别资源失败也不阻塞安装
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // 只接管同源请求
  if (url.origin !== location.origin) return;

  // 页面导航：优先网络，失败再回缓存（保证能拿到最新版本，断网也能开）
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
    );
    return;
  }

  // 静态资源：缓存优先
  e.respondWith(
    caches.match(req).then(hit => {
      if (hit) return hit;
      return fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match('./index.html'));
    })
  );
});

/* 允许页面主动要求更新 */
self.addEventListener('message', e => {
  if (e.data === 'skip-waiting') self.skipWaiting();
});
