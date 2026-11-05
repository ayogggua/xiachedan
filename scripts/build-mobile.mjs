import { existsSync, readdirSync, mkdirSync, copyFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const environment = { ...process.env };
const toolchain = path.join(root, '.cache', 'mobile-toolchain');

if (!environment.JAVA_HOME && process.platform === 'darwin') {
  const detected = spawnSync('/usr/libexec/java_home', ['-v', '21'], { encoding: 'utf8' });
  if (detected.status === 0) environment.JAVA_HOME = detected.stdout.trim();
  else {
    const directory = path.join(toolchain, 'jdk');
    const candidate = existsSync(directory) && readdirSync(directory).map(name => path.join(directory, name, 'Contents', 'Home')).find(home => existsSync(path.join(home, 'bin', 'jlink')));
    if (candidate) environment.JAVA_HOME = candidate;
  }
}
if (!environment.ANDROID_HOME && !environment.ANDROID_SDK_ROOT) {
  const candidates = [path.join(os.homedir(), 'Library', 'Android', 'sdk'), path.join(toolchain, 'android-sdk')];
  environment.ANDROID_HOME = candidates.find(directory => existsSync(path.join(directory, 'platforms')));
  if (!environment.ANDROID_HOME) throw new Error('请先安装 Android SDK，或设置 ANDROID_HOME');
}
if (!environment.GRADLE_USER_HOME && existsSync(path.join(toolchain, 'gradle'))) environment.GRADLE_USER_HOME = path.join(toolchain, 'gradle');
if (process.platform === 'darwin') environment.JAVA_TOOL_OPTIONS = `${environment.JAVA_TOOL_OPTIONS || ''} -Djava.net.useSystemProxies=true`.trim();

const executable = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
const result = spawnSync(executable, ['assembleDebug', '--console=plain'], { cwd: path.join(root, 'mobile', 'android'), env: environment, stdio: 'inherit', shell: process.platform === 'win32' });
if (result.status !== 0) process.exit(result.status || 1);
const version = readFileSync(path.join(root, 'mobile', 'android', 'app', 'build.gradle'), 'utf8').match(/versionName\s+"([0-9]+\.[0-9]+\.[0-9]+)"/)?.[1];
if (!version) throw new Error('请在安卓工程中设置有效的应用版本');
const destination = path.join(root, 'release', `xiachedan-mobile-${version}-debug.apk`);
mkdirSync(path.dirname(destination), { recursive: true });
copyFileSync(path.join(root, 'mobile', 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk'), destination);
console.log(`安卓安装包：${destination}`);
