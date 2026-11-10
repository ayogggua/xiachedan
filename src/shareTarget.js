// 读取系统分享菜单交过来的内容（Service Worker 先存进缓存），读完就删掉。
const SHARE_CACHE = 'xiachedan-share';
export const pendingShareId = () => new URLSearchParams(location.search).get('share');
export async function takeShare(id) {
  if (!/^[a-z0-9]{1,20}$/.test(id || '') || !('caches' in window)) return null;
  const cache = await caches.open(SHARE_CACHE);
  const meta = await (await cache.match(`/__share/${id}/meta`))?.json();
  if (!meta) return null;
  const files = [];
  for (const item of meta.files) {
    const response = await cache.match(item.key);
    if (response) files.push(new File([await response.blob()], item.name, { type: item.type }));
    await cache.delete(item.key);
  }
  await cache.delete(`/__share/${id}/meta`);
  // 分享网页时，标题、文字和链接合成一段。
  const text = [meta.title, meta.text, meta.url].filter((value, index, list) => value && !list.slice(0, index).some(other => other.includes(value))).join('\n');
  return { text, files };
}
