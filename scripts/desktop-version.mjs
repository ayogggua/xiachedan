import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function normalizeVersion(value) {
  const version = String(value).trim().replace(/^v/, '');
  if (!versionPattern.test(version) || !version.split('.').every(part => Number.isSafeInteger(Number(part)))) {
    throw new Error('版本号必须是正式版本，如 1.4.2 或 v1.4.2');
  }
  return version;
}

export function compareVersions(left, right) {
  const a = normalizeVersion(left).split('.').map(Number);
  const b = normalizeVersion(right).split('.').map(Number);
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

export function chooseVersion({ base, tags = [], requested = '', bump = 'auto' }) {
  if (!['auto', 'patch', 'minor', 'major'].includes(bump)) throw new Error('无效的版本递增方式');
  if (requested.trim()) return normalizeVersion(requested);
  if (bump === 'auto' && tags.length) return [...tags].sort(compareVersions).at(-1).replace(/^v/, '');
  const parts = normalizeVersion(base).split('.').map(Number);
  const index = { auto: 2, patch: 2, minor: 1, major: 0 }[bump];
  parts[index]++;
  for (let i = index + 1; i < parts.length; i++) parts[i] = 0;
  return normalizeVersion(parts.join('.'));
}

const git = (...args) => execFileSync('git', args, { cwd: project, encoding: 'utf8' }).trim();
const stableTags = text => text.split('\n').filter(tag => /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag));

function latestMainTag() {
  return stableTags(git('tag', '--merged', 'origin/main', '--list', 'v*')).sort(compareVersions).at(-1);
}

function verifyRelease(value) {
  const version = normalizeVersion(value);
  const source = git('rev-parse', 'HEAD');
  const ancestry = spawnSync('git', ['merge-base', '--is-ancestor', source, 'origin/main'], { cwd: project });
  if (ancestry.status !== 0) throw new Error('正式发布提交必须属于 main');
  const latest = latestMainTag();
  if (latest && compareVersions(version, latest) < 0) throw new Error(`发布版本不能低于 main 已有的 ${latest}`);
  const tag = `v${version}`;
  const existing = spawnSync('git', ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`], { cwd: project, encoding: 'utf8' });
  if (existing.status === 0 && existing.stdout.trim() !== source) throw new Error(`${tag} 已指向其他提交，请选择更高版本`);
  if (existing.status !== 0 && existing.status !== 128) throw new Error('无法检查版本 tag');
}

export function applyVersion(value, directory = project) {
  const version = normalizeVersion(value);
  const packageFile = path.join(directory, 'package.json');
  const lockFile = path.join(directory, 'package-lock.json');
  const cargoFile = path.join(directory, 'src-tauri/Cargo.toml');
  const cargoLockFile = path.join(directory, 'src-tauri/Cargo.lock');
  const pkg = JSON.parse(readFileSync(packageFile, 'utf8'));
  const lock = JSON.parse(readFileSync(lockFile, 'utf8'));
  if (!lock.packages?.['']) throw new Error('package-lock.json 缺少根包信息');
  pkg.version = lock.version = lock.packages[''].version = version;

  let crateName;
  function rewriteToml(text, select) {
    let matches = 0;
    const result = text.split(/(?=^\[)/m).map(block => {
      if (!select(block)) return block;
      const versionLine = /^version[ \t]*=[ \t]*"[^"]+"[^\r\n]*/m;
      if (!versionLine.test(block)) throw new Error('Rust 包缺少版本号');
      matches++;
      return block.replace(versionLine, `version = "${version}"`);
    }).join('');
    if (matches !== 1) throw new Error('无法唯一定位 Rust 应用版本');
    return result;
  }
  const cargo = rewriteToml(readFileSync(cargoFile, 'utf8'), block => {
    if (!/^\[package\]\r?\n/.test(block)) return false;
    crateName = block.match(/^name[ \t]*=[ \t]*"([^"]+)"/m)?.[1];
    if (!crateName) throw new Error('Cargo.toml 缺少应用包名');
    return true;
  });
  const cargoLock = rewriteToml(readFileSync(cargoLockFile, 'utf8'), block =>
    /^\[\[package\]\]\r?\n/.test(block) && block.match(/^name[ \t]*=[ \t]*"([^"]+)"/m)?.[1] === crateName);

  for (const [file, contents] of [
    [packageFile, `${JSON.stringify(pkg, null, 2)}\n`],
    [lockFile, `${JSON.stringify(lock, null, 2)}\n`],
    [cargoFile, cargo],
    [cargoLockFile, cargoLock],
  ]) writeFileSync(file, contents);
  console.log(`本次构建版本：${version}`);
}

function output(values) {
  for (const [key, value] of Object.entries(values)) {
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  }
  console.log(JSON.stringify(values));
}

function resolveVersion() {
  const event = process.env.GITHUB_EVENT_NAME;
  const ref = process.env.GITHUB_REF;
  if (!['push', 'workflow_dispatch'].includes(event)) throw new Error('只支持 main 推送、版本 tag 或手动运行');
  const source = git('rev-parse', 'HEAD');
  const main = git('rev-parse', 'origin/main');
  const isTag = ref?.startsWith('refs/tags/');
  const manual = event === 'workflow_dispatch';
  const publish = manual ? process.env.PUBLISH_RELEASE === 'true' : true;
  const skip = reason => output({ build: 'false', publish: 'false', reason });
  if (manual && publish && ref !== 'refs/heads/main') throw new Error('正式发布只能从 main 手动运行；其他分支可手动打包');
  if (!manual && !isTag && ref !== 'refs/heads/main') return skip('其他分支只支持手动运行');
  if (!manual && !isTag && source !== main) return skip('main 已有更新提交，由最新提交的工作流构建');
  if (publish) {
    const ancestry = spawnSync('git', ['merge-base', '--is-ancestor', source, main], { cwd: project });
    if (ancestry.status === 1) return skip('该版本 tag 不属于 main，不自动构建');
    if (ancestry.status !== 0) throw new Error('无法确认发布提交是否属于 main');
  }

  const tagsOnCommit = stableTags(git('tag', '--points-at', source, '--list', 'v*'));
  const current = JSON.parse(readFileSync(path.join(project, 'package.json'), 'utf8')).version;
  const base = latestMainTag() || normalizeVersion(current);
  const requested = manual ? process.env.VERSION_INPUT || '' : isTag ? ref.slice('refs/tags/'.length) : '';
  const version = chooseVersion({ base, tags: tagsOnCommit, requested, bump: manual ? process.env.VERSION_BUMP || 'auto' : 'auto' });
  const tag = `v${version}`;
  if (publish) verifyRelease(version);
  output({ build: 'true', publish: String(publish), version, tag, source_sha: source });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv[2] === 'resolve') resolveVersion();
    else if (process.argv[2] === 'apply') applyVersion(process.env.DESKTOP_VERSION || '');
    else if (process.argv[2] === 'verify') verifyRelease(process.env.DESKTOP_VERSION || '');
    else throw new Error('用法：desktop-version.mjs resolve|apply|verify');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
