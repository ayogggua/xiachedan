import { mobileClient, nativeMobile, mobilePlatform, mobileHeaders, serverOrigin } from './session';

const notice = message => window.dispatchEvent(new CustomEvent('linliao:notice', { detail: message }));

export async function copyText(text) {
  if (window.desktop?.copy) return window.desktop.copy(text);
  if (nativeMobile) {
    const { Clipboard } = await import('@capacitor/clipboard');
    return Clipboard.write({ string: text });
  }
  return navigator.clipboard.writeText(text);
}

export async function saveDownload(address, name = '附件') {
  const url = new URL(address, location.origin);
  if (url.origin !== new URL(serverOrigin() || location.origin).origin || !['/api/media', '/api/export'].includes(url.pathname)) throw new Error('文件地址无效');
  url.searchParams.delete('access');
  if (!nativeMobile) {
    const response = await fetch(url, { credentials: mobileClient ? 'omit' : 'include', headers: mobileHeaders() });
    if (!response.ok) throw new Error('文件下载失败，请重新登录后重试');
    const blob = await response.blob(), link = document.createElement('a');
    link.href = URL.createObjectURL(blob); link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 30000);
    return;
  }
  const [{ Filesystem, Directory }, { FileTransfer }, { Share }] = await Promise.all([
    import('@capacitor/filesystem'), import('@capacitor/file-transfer'), import('@capacitor/share'),
  ]);
  const filename = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(-160) || '附件';
  const folder = `shared/${Date.now()}`;
  await Filesystem.mkdir({ path: folder, directory: Directory.Cache, recursive: true });
  const { uri } = await Filesystem.getUri({ path: `${folder}/${filename}`, directory: Directory.Cache });
  notice('正在准备文件…');
  await FileTransfer.downloadFile({ url: url.href, path: uri, headers: mobileHeaders() });
  await Share.share({ title: filename, files: [uri], dialogTitle: '保存或分享文件' });
}

export function setupViewport() {
  const update = () => {
    if (window.visualViewport?.scale && window.visualViewport.scale !== 1) return;
    if (innerWidth <= 760 || mobileClient) document.documentElement.style.setProperty('--app-height', `${window.visualViewport?.height || innerHeight}px`);
    else document.documentElement.style.removeProperty('--app-height');
  };
  update(); window.addEventListener('resize', update); window.visualViewport?.addEventListener('resize', update);
  return () => { window.removeEventListener('resize', update); window.visualViewport?.removeEventListener('resize', update); };
}

export async function initializeNative() {
  if (!nativeMobile) return () => {};
  const [{ App }, { Keyboard }, { StatusBar, Style }, { Browser }] = await Promise.all([
    import('@capacitor/app'), import('@capacitor/keyboard'), import('@capacitor/status-bar'), import('@capacitor/browser'),
  ]);
  let keyboardVisible = false;
  const handles = await Promise.all([
    App.addListener('appStateChange', ({ isActive }) => { if (isActive) window.dispatchEvent(new Event('linliao:resume')); }),
    App.addListener('backButton', async () => {
      if (keyboardVisible) { await Keyboard.hide(); return; }
      const event = new Event('linliao:back', { cancelable: true });
      if (window.dispatchEvent(event) && mobilePlatform === 'android') await App.minimizeApp();
    }),
    Keyboard.addListener('keyboardWillShow', () => { keyboardVisible = true; document.documentElement.classList.add('keyboard-open'); }),
    Keyboard.addListener('keyboardWillHide', () => { keyboardVisible = false; document.documentElement.classList.remove('keyboard-open'); }),
  ]);
  const syncTheme = () => StatusBar.setStyle({ style: document.documentElement.dataset.theme === 'light' ? Style.Dark : Style.Light }).catch(() => {});
  await syncTheme();
  const observer = new MutationObserver(syncTheme);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const openLink = event => {
    const link = event.target.closest('a[href]');
    if (!link || event.defaultPrevented) return;
    const url = new URL(link.href, location.origin);
    if (link.hasAttribute('download') && url.origin === serverOrigin()) {
      event.preventDefault();
      saveDownload(url.href, link.download || '附件').catch(error => notice(error.message || '文件保存失败'));
    } else if (['http:', 'https:'].includes(url.protocol) && url.origin !== location.origin) {
      event.preventDefault(); Browser.open({ url: url.href }).catch(() => notice('无法打开链接'));
    }
  };
  document.addEventListener('click', openLink);
  return () => { handles.forEach(handle => handle.remove()); observer.disconnect(); document.removeEventListener('click', openLink); };
}
