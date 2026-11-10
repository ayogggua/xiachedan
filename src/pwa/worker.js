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

// 手机推送：每条推送都必须显示通知（Safari 的要求）；同一会话的通知用 tag 合并成一条。
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data?.json() || {}; } catch {}
  event.waitUntil(self.registration.showNotification(data.title || '虾扯蛋', {
    body: data.body || '你有一条新消息', tag: data.roomId || 'xiachedan', renotify: true, icon: '/icons/app-192.png',
    data: { roomId: data.roomId || '', messageId: data.threadOf || data.messageId || '' },
  }));
});

// 点通知：已经开着页面就切过去并跳到那条消息，否则打开新页面。
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const { roomId, messageId } = event.notification.data || {};
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const current = windows.find(item => new URL(item.url).origin === self.location.origin);
    if (current) {
      await current.focus();
      if (roomId && messageId) current.postMessage({ type: 'open-message', roomId, id: messageId });
      return;
    }
    await self.clients.openWindow(roomId && messageId ? `/#msg=${encodeURIComponent(roomId)}/${encodeURIComponent(messageId)}` : '/');
  })());
});

// 系统分享菜单发来的文字和文件：先存进缓存，再打开 App 让用户选会话（最多 6 个文件）。
const SHARE_CACHE = 'xiachedan-share';
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || url.origin !== self.location.origin || url.pathname !== '/share-target') return;
  event.respondWith((async () => {
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    try {
      const form = await event.request.formData();
      const cache = await caches.open(SHARE_CACHE);
      const files = form.getAll('files').filter(file => typeof file === 'object' && file.size > 0).slice(0, 6);
      const meta = { title: String(form.get('title') || ''), text: String(form.get('text') || ''), url: String(form.get('url') || ''),
        files: files.map((file, index) => ({ name: file.name || `文件${index + 1}`, type: file.type || 'application/octet-stream', key: `/__share/${id}/${index}` })) };
      await Promise.all(files.map((file, index) => cache.put(meta.files[index].key, new Response(file, { headers: { 'Content-Type': meta.files[index].type } }))));
      await cache.put(`/__share/${id}/meta`, new Response(JSON.stringify(meta), { headers: { 'Content-Type': 'application/json' } }));
    } catch {}
    return Response.redirect(`/?share=${id}`, 303);
  })());
});
