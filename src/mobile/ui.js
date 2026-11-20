import { useEffect, useRef, useState } from 'react';
import { nativeMobile } from './session';

const MOBILE_QUERY = '(max-width: 760px)';
const COARSE_QUERY = '(pointer: coarse)';
const BACK_KEY = '__linliaoBack';

export const isMobileViewport = () => typeof window !== 'undefined' && !window.desktop && window.matchMedia(MOBILE_QUERY).matches;
export const isCoarsePointer = () => typeof window !== 'undefined' && !window.desktop && window.matchMedia(COARSE_QUERY).matches;
export const isTouchMobile = () => isMobileViewport() || isCoarsePointer();

export function useIsMobile() {
  const [mobile, setMobile] = useState(isMobileViewport);
  useEffect(() => {
    if (window.desktop) return;
    const media = window.matchMedia(MOBILE_QUERY);
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return mobile;
}

const themeColorState = { arcadeOpen: false, inChat: false };

export function syncThemeColor(patch) {
  if (typeof document === 'undefined') return;
  if (patch && typeof patch === 'object') Object.assign(themeColorState, patch);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  const light = document.documentElement.dataset.theme === 'light';
  const classic = document.documentElement.dataset.skin === 'classic';
  const mobile = window.matchMedia(MOBILE_QUERY).matches;
  let color;
  if (themeColorState.arcadeOpen) {
    color = '#0e1412';
  } else if (classic) {
    color = light ? (mobile ? (themeColorState.inChat ? '#ededed' : '#ffffff') : '#fbfbfb') : (mobile ? '#111111' : '#141414');
  } else {
    color = light ? '#f7f6f4' : '#1c1c1e';
  }
  meta.setAttribute('content', color);
}

if (typeof window !== 'undefined') {
  window.matchMedia(MOBILE_QUERY).addEventListener('change', () => syncThemeColor());
}

// 仅移动端非原生浏览器（含 PWA）启用虚拟返回栈：单哨兵条目，逐级关闭弹窗/面板/聊天/游戏厅，避免系统返回直接退出应用。
export function usePwaBackStack(hasBackTarget, onBack) {
  const mobile = useIsMobile();
  const enabled = mobile && !nativeMobile && !window.desktop;
  const activeRef = useRef(hasBackTarget);
  const onBackRef = useRef(onBack);
  const ignoringPop = useRef(false);
  const pushTimer = useRef(0);
  const ignoreTimer = useRef(0);
  activeRef.current = hasBackTarget;
  onBackRef.current = onBack;

  const pushSentinel = () => {
    if (history.state?.[BACK_KEY]) return;
    try {
      const next = history.state && typeof history.state === 'object' ? { ...history.state, [BACK_KEY]: true } : { [BACK_KEY]: true };
      history.pushState(next, '', location.pathname + location.search + location.hash);
    } catch {}
  };

  useEffect(() => {
    if (!enabled) return;
    const onPopState = () => {
      if (ignoringPop.current) {
        ignoringPop.current = false;
        clearTimeout(ignoreTimer.current);
        return;
      }
      if (!activeRef.current) return;
      onBackRef.current?.();
      clearTimeout(pushTimer.current);
      pushTimer.current = setTimeout(() => {
        if (activeRef.current && !history.state?.[BACK_KEY]) pushSentinel();
      }, 0);
    };
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
      clearTimeout(pushTimer.current);
      clearTimeout(ignoreTimer.current);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    if (hasBackTarget) {
      pushSentinel();
    } else if (history.state?.[BACK_KEY]) {
      ignoringPop.current = true;
      clearTimeout(ignoreTimer.current);
      ignoreTimer.current = setTimeout(() => { ignoringPop.current = false; }, 300);
      try { history.back(); } catch { ignoringPop.current = false; }
    }
  }, [enabled, hasBackTarget]);
}

// 移动端左边缘右滑返回会话列表：仅在聊天主视图生效，避开代码块/表格等可横向滚动内容。
const EDGE_ZONE = 28;
const EDGE_SKIP = 'input, textarea, select, [contenteditable="true"], .code-block, .table-scroll, video, audio';

export function useEdgeSwipeBack({ enabled, onBack, appRef, chatRef, sidebarRef }) {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    const chat = chatRef.current;
    if (!enabled || !chat || window.desktop) return;
    let gesture = null;
    let settleTimer = 0;

    const clearStyles = () => {
      appRef.current?.classList.remove('edge-swiping', 'edge-settling');
      if (chatRef.current) chatRef.current.style.transform = '';
      if (sidebarRef.current) sidebarRef.current.style.transform = '';
    };

    const onPointerDown = event => {
      gesture = null;
      if (event.pointerType !== 'touch' || !event.isPrimary || event.clientX > EDGE_ZONE) return;
      if (event.target instanceof Element && event.target.closest(EDGE_SKIP)) return;
      gesture = { id: event.pointerId, startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastTime: event.timeStamp, state: 'pending', velocity: 0 };
    };

    const onPointerMove = event => {
      if (!gesture || gesture.id !== event.pointerId) return;
      const dx = event.clientX - gesture.startX;
      const dy = event.clientY - gesture.startY;
      if (gesture.state === 'pending') {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        if (dx <= 0 || Math.abs(dy) * 1.2 >= dx) { gesture = null; return; }
        gesture.state = 'drag';
        clearTimeout(settleTimer);
        appRef.current?.classList.remove('edge-settling');
        appRef.current?.classList.add('edge-swiping');
        try { chat.setPointerCapture(event.pointerId); } catch {}
      }
      const clamped = Math.max(0, Math.min(window.innerWidth, dx));
      const dt = Math.max(1, event.timeStamp - gesture.lastTime);
      gesture.velocity = (event.clientX - gesture.lastX) / dt;
      gesture.lastX = event.clientX;
      gesture.lastTime = event.timeStamp;
      const progress = clamped / Math.max(1, window.innerWidth);
      chat.style.transform = `translate3d(${clamped}px, 0, 0)`;
      if (sidebarRef.current) sidebarRef.current.style.transform = `translate3d(${(-22 * (1 - progress)).toFixed(2)}%, 0, 0)`;
    };

    const finish = (event, cancelled) => {
      if (!gesture || gesture.id !== event.pointerId) return;
      const current = gesture;
      gesture = null;
      try { if (chat.hasPointerCapture?.(event.pointerId)) chat.releasePointerCapture(event.pointerId); } catch {}
      if (current.state !== 'drag') return;
      const dx = Math.max(0, event.clientX - current.startX);
      const trigger = !cancelled && (dx > Math.min(110, window.innerWidth * 0.28) || current.velocity > 0.45);
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduced) {
        clearStyles();
        if (trigger) onBackRef.current?.();
        return;
      }
      appRef.current?.classList.remove('edge-swiping');
      appRef.current?.classList.add('edge-settling');
      if (trigger) {
        chat.style.transform = 'translate3d(100%, 0, 0)';
        if (sidebarRef.current) sidebarRef.current.style.transform = 'translate3d(0, 0, 0)';
        settleTimer = setTimeout(() => {
          onBackRef.current?.();
          requestAnimationFrame(clearStyles);
        }, 210);
      } else {
        chat.style.transform = 'translate3d(0, 0, 0)';
        if (sidebarRef.current) sidebarRef.current.style.transform = 'translate3d(-22%, 0, 0)';
        settleTimer = setTimeout(clearStyles, 220);
      }
    };

    const onUp = event => finish(event, false);
    const onCancel = event => finish(event, true);
    chat.addEventListener('pointerdown', onPointerDown);
    chat.addEventListener('pointermove', onPointerMove);
    chat.addEventListener('pointerup', onUp);
    chat.addEventListener('pointercancel', onCancel);
    return () => {
      clearTimeout(settleTimer);
      clearStyles();
      chat.removeEventListener('pointerdown', onPointerDown);
      chat.removeEventListener('pointermove', onPointerMove);
      chat.removeEventListener('pointerup', onUp);
      chat.removeEventListener('pointercancel', onCancel);
    };
  }, [enabled, appRef, chatRef, sidebarRef]);
}
