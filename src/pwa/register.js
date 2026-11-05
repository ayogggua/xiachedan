export function registerPwa() {
  if (import.meta.env.MODE !== 'pwa' || !import.meta.env.PROD || window.desktop || !window.isSecureContext || !('serviceWorker' in navigator)) return;
  const register = async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
      let checked = Date.now();
      const update = () => {
        if (document.visibilityState === 'hidden' || Date.now() - checked < 60000) return;
        checked = Date.now(); registration.update().catch(() => {});
      };
      window.addEventListener('online', update);
      document.addEventListener('visibilitychange', update);
    } catch { /* 浏览器不允许安装时仍可在线使用。 */ }
  };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
