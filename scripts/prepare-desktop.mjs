// 为 Tauri 打包准备 Node 运行时（sidecar）和本机服务资源：node scripts/prepare-desktop.mjs [目标三元组]
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NODE_VERSION = 'v22.23.4';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const triple = process.argv[2] || process.env.TAURI_TARGET_TRIPLE || execFileSync('rustc', ['--print', 'host-tuple'], { encoding: 'utf8' }).trim();
const platforms = {
  'aarch64-apple-darwin': { dist: 'darwin-arm64', archive: 'tar.xz', binary: 'bin/node' },
  'x86_64-apple-darwin': { dist: 'darwin-x64', archive: 'tar.xz', binary: 'bin/node' },
  'x86_64-pc-windows-msvc': { dist: 'win-x64', archive: 'zip', binary: 'node.exe' },
  'aarch64-pc-windows-msvc': { dist: 'win-arm64', archive: 'zip', binary: 'node.exe' },
};
const platform = platforms[triple];
if (!platform) throw new Error(`暂不支持的目标平台：${triple}`);

async function download(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`下载失败 ${response.status}：${url}`);
  return Buffer.from(await response.arrayBuffer());
}

const cache = path.join(root, '.cache', 'node');
mkdirSync(cache, { recursive: true });
const name = `node-${NODE_VERSION}-${platform.dist}`;
const archive = path.join(cache, `${name}.${platform.archive}`);
const base = `https://nodejs.org/dist/${NODE_VERSION}`;
const sums = (await download(`${base}/SHASUMS256.txt`)).toString();
const expected = sums.split('\n').find(line => line.endsWith(`  ${name}.${platform.archive}`))?.split(' ')[0];
if (!expected) throw new Error(`官方校验清单中没有 ${name}`);
if (!existsSync(archive) || createHash('sha256').update(readFileSync(archive)).digest('hex') !== expected) {
  const data = await download(`${base}/${name}.${platform.archive}`);
  if (createHash('sha256').update(data).digest('hex') !== expected) throw new Error(`${name} 校验失败`);
  writeFileSync(archive, data);
}
const extracted = path.join(cache, name);
rmSync(extracted, { recursive: true, force: true });
execFileSync('tar', ['-xf', archive, '-C', cache, `${name}/${platform.binary}`]);
const binaries = path.join(root, 'src-tauri', 'binaries');
mkdirSync(binaries, { recursive: true });
const sidecar = path.join(binaries, `node-${triple}${platform.archive === 'zip' ? '.exe' : ''}`);
cpSync(path.join(extracted, platform.binary), sidecar);
chmodSync(sidecar, 0o755);

// 本机服务：前端构建产物 + 服务端代码 + 仅生产依赖。
const app = path.join(root, 'src-tauri', 'resources', 'app');
rmSync(app, { recursive: true, force: true });
mkdirSync(app, { recursive: true });
if (!existsSync(path.join(root, 'dist', 'index.html'))) throw new Error('请先运行 npm run build');
for (const entry of ['dist', 'server', 'shared', 'package.json', 'package-lock.json']) cpSync(path.join(root, entry), path.join(app, entry), { recursive: true });
execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: app, stdio: 'inherit', shell: process.platform === 'win32' });
rmSync(path.join(app, 'package-lock.json'));
console.log(`已准备 ${triple}：${path.relative(root, sidecar)} 与 src-tauri/resources/app`);
