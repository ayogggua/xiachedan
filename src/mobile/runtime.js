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
  let rafId = 0;
  let wasKeyboardOpen = false;
  let touchStart = null;
  const settleTimers = new Set();

  const isNarrow = () => !window.desktop && (innerWidth <= 760 || mobileClient);
  const clearSettleTimers = () => {
    for (const id of settleTimers) clearTimeout(id);
    settleTimers.clear();
  };

  const update = () => {
    const root = document.documentElement;
    const vv = window.visualViewport;
    if (!isNarrow()) {
      wasKeyboardOpen = false;
      root.style.removeProperty('--app-height');
      root.style.removeProperty('--app-top');
      root.style.removeProperty('--app-bottom');
      if (!nativeMobile) root.classList.remove('keyboard-open');
      return;
    }
    if (vv?.scale && Math.abs(vv.scale - 1) > 0.02) return;
    const layoutHeight = root.clientHeight || innerHeight;
    const height = Math.round(vv?.height || innerHeight);
    const top = Math.max(0, Math.round(vv?.offsetTop || 0));
    const bottom = Math.max(0, Math.round(layoutHeight - height - top));
    root.style.setProperty('--app-height', `${height}px`);
    root.style.setProperty('--app-top', `${top}px`);
    root.style.setProperty('--app-bottom', `${bottom}px`);
    if (!nativeMobile && vv) {
      const keyboardOpen = layoutHeight - height > 120;
      root.classList.toggle('keyboard-open', keyboardOpen);
      if (!keyboardOpen && (wasKeyboardOpen || window.scrollY !== 0 || window.scrollX !== 0 || top > 0)) {
        window.scrollTo(0, 0);
        if (top > 0) schedule(60);
      }
      wasKeyboardOpen = keyboardOpen;
    }
  };

  const schedule = (delay = 0) => {
    if (delay > 0) {
      const id = setTimeout(() => { settleTimers.delete(id); update(); }, delay);
      settleTimers.add(id);
      return;
    }
    if (rafId) return;
    rafId = requestAnimationFrame(() => { rafId = 0; update(); });
  };

  const onFocusChange = event => {
    if (!isNarrow() || nativeMobile) return;
    const target = event.target;
    if (!(target instanceof Element) || !target.matches('input, textarea, select, [contenteditable="true"]')) return;
    schedule();
    schedule(90);
    schedule(240);
    schedule(400);
  };

  const isScrollableY = el => {
    const style = getComputedStyle(el);
    return /(auto|scroll|overlay)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1;
  };
  const isScrollableX = el => {
    const style = getComputedStyle(el);
    return /(auto|scroll|overlay)/.test(style.overflowX) && el.scrollWidth > el.clientWidth + 1;
  };
  const findScrollable = (target, check) => {
    for (let node = target; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
      if (check(node)) return node;
    }
    return null;
  };

  const isIOSBrowser = () => !nativeMobile && !window.desktop && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

  const onTouchStart = event => {
    if (nativeMobile || !isNarrow() || event.touches.length !== 1) { touchStart = null; return; }
    const touch = event.touches[0];
    touchStart = { x: touch.clientX, y: touch.clientY, lastX: touch.clientX, lastY: touch.clientY, target: event.target };
    // iOS Safari 在浏览器有历史记录时，屏幕极左/极右边缘会触发整页左右滑切页；非交互元素边缘触碰时阻止系统手势接管。
    if (isIOSBrowser() && event.cancelable && (touch.clientX <= 16 || touch.clientX >= innerWidth - 16)) {
      const target = event.target instanceof Element ? event.target : null;
      if (target && !target.closest('button, a, input, textarea, select, label, [role="button"], [role="tab"], .image-viewer, .image-editor-stage, .cropper-stage')) {
        event.preventDefault();
      }
    }
  };

  const onTouchMove = event => {
    if (!touchStart || nativeMobile || !isNarrow() || event.touches.length !== 1 || !event.cancelable) return;
    const vv = window.visualViewport;
    if (vv?.scale && Math.abs(vv.scale - 1) > 0.02) return;
    const target = touchStart.target instanceof Element ? touchStart.target : null;
    if (!target) return;
    if (target.closest('input[type="range"], .image-viewer, .image-editor-stage, .cropper-stage')) return;
    const touch = event.touches[0];
    const stepX = touch.clientX - touchStart.lastX;
    const stepY = touch.clientY - touchStart.lastY;
    const totalX = Math.abs(touch.clientX - touchStart.x);
    const totalY = Math.abs(touch.clientY - touchStart.y);
    touchStart.lastX = touch.clientX;
    touchStart.lastY = touch.clientY;
    if (stepX === 0 && stepY === 0) return;
    if (totalX > totalY) {
      if (target.closest('input, textarea, [contenteditable="true"]')) return;
      const scrollerX = findScrollable(target, isScrollableX);
      if (!scrollerX) { event.preventDefault(); return; }
      const atLeft = scrollerX.scrollLeft <= 0;
      const atRight = scrollerX.scrollLeft + scrollerX.clientWidth >= scrollerX.scrollWidth - 1;
      if ((stepX > 0 && atLeft) || (stepX < 0 && atRight)) event.preventDefault();
      return;
    }
    const scrollerY = findScrollable(target, isScrollableY);
    if (!scrollerY) { event.preventDefault(); return; }
    const atTop = scrollerY.scrollTop <= 0;
    const atBottom = scrollerY.scrollTop + scrollerY.clientHeight >= scrollerY.scrollHeight - 1;
    if ((stepY > 0 && atTop) || (stepY < 0 && atBottom)) event.preventDefault();
  };

  const onTouchEnd = () => { touchStart = null; };
  const onOrientation = () => { schedule(120); schedule(320); };

  update();
  window.addEventListener('resize', update);
  window.addEventListener('orientationchange', onOrientation);
  window.visualViewport?.addEventListener('resize', update);
  window.visualViewport?.addEventListener('scroll', update);
  document.addEventListener('focusin', onFocusChange);
  document.addEventListener('focusout', onFocusChange);
  document.addEventListener('touchstart', onTouchStart, { passive: false });
  document.addEventListener('touchmove', onTouchMove, { passive: false });
  document.addEventListener('touchend', onTouchEnd, { passive: true });
  document.addEventListener('touchcancel', onTouchEnd, { passive: true });
  return () => {
    if (rafId) cancelAnimationFrame(rafId);
    clearSettleTimers();
    window.removeEventListener('resize', update);
    window.removeEventListener('orientationchange', onOrientation);
    window.visualViewport?.removeEventListener('resize', update);
    window.visualViewport?.removeEventListener('scroll', update);
    document.removeEventListener('focusin', onFocusChange);
    document.removeEventListener('focusout', onFocusChange);
    document.removeEventListener('touchstart', onTouchStart);
    document.removeEventListener('touchmove', onTouchMove);
    document.removeEventListener('touchend', onTouchEnd);
    document.removeEventListener('touchcancel', onTouchEnd);
    if (!nativeMobile) document.documentElement.classList.remove('keyboard-open');
  };
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
