import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const worker = readFileSync(new URL('../src/pwa/worker.js', import.meta.url), 'utf8');
const icons = [192, 512].map(size => ({ src: `/icons/app-${size}.png`, sizes: `${size}x${size}`, type: 'image/png', purpose: 'any maskable' }));

export default function pwa() {
  return {
    name: 'xiachedan-pwa',
    enforce: 'post',
    apply: 'build',
    transformIndexHtml() {
      return [
        { tag: 'link', attrs: { rel: 'manifest', href: '/manifest.webmanifest' } },
        { tag: 'link', attrs: { rel: 'apple-touch-icon', href: '/icons/apple-touch-icon.png' } },
        { tag: 'meta', attrs: { name: 'mobile-web-app-capable', content: 'yes' } },
        { tag: 'meta', attrs: { name: 'apple-mobile-web-app-capable', content: 'yes' } },
        { tag: 'meta', attrs: { name: 'apple-mobile-web-app-title', content: '虾扯蛋' } },
        { tag: 'meta', attrs: { name: 'apple-mobile-web-app-status-bar-style', content: 'default' } },
      ];
    },
    generateBundle(_options, bundle) {
      const manifest = JSON.stringify({
        id: '/', name: '虾扯蛋', short_name: '虾扯蛋', lang: 'zh-CN',
        start_url: '/', scope: '/', display: 'standalone',
        background_color: '#1c1c1e', theme_color: '#1c1c1e', categories: ['social', 'productivity'], icons,
        // 安装后出现在系统分享菜单里（安卓 Chrome）；由 Service Worker 接住，再让用户选发到哪个会话。
        share_target: { action: '/share-target', method: 'POST', enctype: 'multipart/form-data',
          params: { title: 'title', text: 'text', url: 'url', files: [{ name: 'files', accept: ['image/*', 'video/*', 'audio/*', 'text/*', 'application/*'] }] } },
      }, null, 2);
      const files = [...new Set(['/index.html', '/manifest.webmanifest', '/icons/apple-touch-icon.png',
        ...icons.map(icon => icon.src), ...Object.keys(bundle).filter(file => !file.endsWith('.map')).map(file => `/${file}`)])].sort();
      const hash = createHash('sha256').update(JSON.stringify(files)).update(manifest).update(worker)
        .update(String(bundle['index.html']?.source || ''));
      for (const icon of [...icons.map(icon => icon.src), '/icons/apple-touch-icon.png']) hash.update(readFileSync(new URL(`../public${icon}`, import.meta.url)));
      const version = hash.digest('hex').slice(0, 16);
      this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: manifest });
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: worker.replace("'__PWA_CACHE__'", JSON.stringify(`xiachedan-shell-${version}`)).replace('__PWA_FILES__', JSON.stringify(files)) });
    },
  };
}
