import { packager } from '@electron/packager';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, mkdtempSync, symlinkSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = process.env.RELEASE_DIR ? path.resolve(process.env.RELEASE_DIR) : path.join(root, 'release');
const icon = path.join(root, 'desktop', 'icon.icns');
const targets = process.env.MAC_ARCH || 'universal';
const applications = await packager({
  dir: root, out: output, name: '虾扯蛋',
  executableName: 'Linliao', appBundleId: 'local.linliao.chat', appCategoryType: 'public.app-category.social-networking',
  platform: 'darwin', arch: targets, overwrite: true, prune: true, asar: true,
  download: { checksums: JSON.parse(readFileSync(path.join(root, 'node_modules/electron/checksums.json'), 'utf8')) },
  ...(existsSync(icon) ? { icon } : {}),
  ignore: [/^\/release($|\/)/, /^\/designs($|\/)/, /^\/\.data($|\/)/, /^\/src($|\/)/, /^\/\.git($|\/)/, /^\/vite\.config\.js$/, /^\/index\.html$/, /^\/desktop\/package\.mjs$/, /^\/\.gitignore$/],
  extendInfo: { LSUIElement: false, NSLocalNetworkUsageDescription: '虾扯蛋需要连接局域网内的 Mac，以发送消息、图片和视频。', NSHumanReadableCopyright: '虾扯蛋 · 有事说事，没事虾扯蛋。' },
});
for (const directory of applications) {
  const app = path.join(directory, '虾扯蛋.app');
  execFileSync('plutil', ['-replace', 'CFBundleDisplayName', '-string', '虾扯蛋', path.join(app, 'Contents/Info.plist')]);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
  const architecture = path.basename(directory).split('-').at(-1);
  const zip = path.join(output, `虾扯蛋-mac-${architecture}.zip`);
  execFileSync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, zip]);
  const dmg = path.join(output, `虾扯蛋-mac-${architecture}.dmg`);
  const staging = mkdtempSync(path.join(tmpdir(), 'linliao-installer-'));
  try {
    chmodSync(staging, 0o755);
    execFileSync('ditto', [app, path.join(staging, '虾扯蛋.app')]);
    symlinkSync('/Applications', path.join(staging, 'Applications'));
    execFileSync('hdiutil', ['create', '-volname', '虾扯蛋', '-srcfolder', staging,
      '-ov', '-format', 'UDZO', '-fs', 'HFS+', dmg], { stdio: 'inherit' });
    execFileSync('hdiutil', ['verify', dmg], { stdio: 'inherit' });
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  console.log(`Mac 应用：${app}\n安装包：${dmg}\n压缩包：${zip}`);
}
