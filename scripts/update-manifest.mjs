// 由发布目录中的更新包与签名生成 Tauri 更新清单：node scripts/update-manifest.mjs <目录> <标签> <owner/repo> [下载地址前缀]
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [directory, tag, repo, base = `https://github.com/${repo}/releases/download/${tag}`] = process.argv.slice(2);
if (!directory || !tag || !repo) throw new Error('用法：update-manifest.mjs <目录> <标签> <owner/repo> [下载地址前缀]');
const platforms = {};
for (const file of readdirSync(directory).filter(name => name.endsWith('.sig'))) {
  const artifact = file.slice(0, -'.sig'.length);
  if (!existsSync(path.join(directory, artifact))) continue;
  const key = artifact.includes('aarch64') && artifact.endsWith('.app.tar.gz') ? 'darwin-aarch64'
    : artifact.includes('x64') && artifact.endsWith('.app.tar.gz') ? 'darwin-x86_64'
    : artifact.endsWith('-setup.exe') ? 'windows-x86_64' : null;
  if (!key) continue;
  platforms[key] = { signature: readFileSync(path.join(directory, file), 'utf8').trim(), url: `${base}/${encodeURIComponent(artifact)}` };
}
if (!Object.keys(platforms).length) {
  console.log('没有找到已签名的更新包，跳过生成更新清单');
  process.exit(0);
}
const version = tag.replace(/^v/, '');
const notes = process.env.RELEASE_NOTES?.trim() || `虾扯蛋 ${tag}`;
const manifest = { version, notes, pub_date: new Date().toISOString(), platforms };
writeFileSync(path.join(directory, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`已生成 latest.json：${Object.keys(platforms).join('、')}`);
