const CACHE_NAME = '__PWA_CACHE__';
const SHELL_FILES = __PWA_FILES__;
const staticPaths = new Set(SHELL_FILES);

self.addEventListener('install', event => {
  // 只保存构建出的界面资源，不保存聊天接口、用户资料或附件。
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_FILES.map(url => new Request(url, { cache: 'reload', credentials: 'omit' })))));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('xiachedan-shell-') && key !== CACHE_NAME) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname === '/socket') return;
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(new Request(request, { cache: 'no-cache' }));
        if (response.ok) return response;
      } catch {}
      return await caches.match('/index.html') || new Response('暂时无法连接，请联网后重试。', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    })());
  } else if (staticPaths.has(url.pathname) && !url.search) {
    event.respondWith(caches.open(CACHE_NAME).then(async cache => await cache.match(request) || fetch(request)));
  }
});
