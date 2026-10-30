import { useCallback, useEffect, useRef, useState } from 'react';
import { readStorage } from './history';

// 隐私模式、窗口激活状态与桌面端事件；网页端没有 window.desktop 时退化为浏览器焦点。
export default function useDesktopBridge({ notify, onPendingRoom, onOpenRoom }) {
  const [privateMode, setPrivateMode] = useState(() => readStorage('linliao.privacy', false));
  const [windowActive, setWindowActive] = useState(() => !window.desktop?.onEvent && document.visibilityState === 'visible' && document.hasFocus());
  const privacyRef = useRef(privateMode);
  const handlers = useRef({ onPendingRoom, onOpenRoom });
  privacyRef.current = privateMode;
  handlers.current = { onPendingRoom, onOpenRoom };
  const changePrivacy = useCallback(value => {
    const next = typeof value === 'function' ? value(privacyRef.current) : value;
    privacyRef.current = next;
    setPrivateMode(next);
    window.desktop?.settings?.({ privateMode: next }).catch(error => notify(error.message));
  }, [notify]);
  useEffect(() => {
    const updateFocus = () => {
      if (!window.desktop?.onEvent) setWindowActive(document.visibilityState === 'visible' && document.hasFocus());
    };
    const blur = () => setWindowActive(false);
    window.addEventListener('focus', updateFocus);
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', updateFocus);
    let cancelled = false;
    const applySettings = data => {
      if (cancelled) return;
      privacyRef.current = data.privateMode;
      setPrivateMode(data.privateMode);
      setWindowActive(data.active);
      if (data.pendingRoom) handlers.current.onPendingRoom(data.pendingRoom);
    };
    const unsubscribe = window.desktop?.onEvent?.(data => {
      if (data.type === 'settings') applySettings(data);
      if (data.type === 'visibility') setWindowActive(data.active);
      if (data.type === 'open-room') handlers.current.onOpenRoom(data.roomId);
    });
    window.desktop?.ready?.(privacyRef.current).then(applySettings).catch(error => notify(error.message));
    return () => {
      cancelled = true;
      unsubscribe?.();
      window.removeEventListener('focus', updateFocus);
      window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', updateFocus);
    };
  }, [notify]);
  useEffect(() => { localStorage.setItem('linliao.privacy', JSON.stringify(privateMode)); }, [privateMode]);
  useEffect(() => {
    const onKey = event => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'p') { event.preventDefault(); changePrivacy(value => !value); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [changePrivacy]);
  return { privateMode, privacyRef, changePrivacy, windowActive };
}
