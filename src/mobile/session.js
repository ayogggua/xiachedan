import { Capacitor } from '@capacitor/core';

export const nativeMobile = Capacitor.isNativePlatform();
export const mobileClient = nativeMobile || import.meta.env.MODE === 'mobile';
export const mobilePlatform = Capacitor.getPlatform();
export const defaultServer = import.meta.env.MODE === 'pwa' ? '' : (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
let token = '';
let mediaTicket = '';

export function serverOrigin() {
  if (import.meta.env.MODE === 'pwa') return '';
  return mobileClient ? (localStorage.getItem('linliao.mobile.server') || defaultServer) : (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
}

export function validateServer(value) {
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error('请输入完整的服务器地址'); }
  const localPreview = import.meta.env.DEV && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(localPreview && url.protocol === 'http:')) throw new Error('服务器地址需要以 https:// 开头');
  if (url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw new Error('请填写服务器地址，不包含路径或登录信息');
  return url.origin;
}

const sessionKey = () => `linliao.session:${serverOrigin()}`;
async function secureStorage() { return (await import('@aparajita/capacitor-secure-storage')).SecureStorage; }

export async function initializeSession() {
  if (!mobileClient || !serverOrigin()) return;
  const saved = nativeMobile ? await (await secureStorage()).get(sessionKey(), false, false) : JSON.parse(sessionStorage.getItem(sessionKey()) || 'null');
  if (saved && /^[0-9a-f]{64}$/.test(saved.token) && saved.expiresAt > Date.now()) token = saved.token;
  else if (saved) await clearSession();
}

export async function acceptSession(mobile) {
  if (!mobileClient || !mobile) return;
  if (mobile.token) {
    if (!/^[0-9a-f]{64}$/.test(mobile.token) || !Number.isFinite(mobile.expiresAt)) throw new Error('登录信息无效，请重新登录');
    const saved = { token: mobile.token, expiresAt: mobile.expiresAt };
    if (nativeMobile) await (await secureStorage()).set(sessionKey(), saved, false, false, 1);
    else sessionStorage.setItem(sessionKey(), JSON.stringify(saved));
    token = mobile.token;
  }
  if (typeof mobile.mediaTicket === 'string' && mediaTicket !== mobile.mediaTicket) {
    mediaTicket = mobile.mediaTicket;
    window.dispatchEvent(new Event('linliao:mobile-session'));
  }
}

export async function clearSession() {
  token = ''; mediaTicket = '';
  if (nativeMobile) await (await secureStorage()).remove(sessionKey(), false);
  else sessionStorage.removeItem(sessionKey());
  window.dispatchEvent(new Event('linliao:mobile-session'));
}

export const mobileHeaders = () => mobileClient ? { 'X-Linliao-Client': 'mobile', ...(token ? { Authorization: `Bearer ${token}` } : {}) } : {};
export const socketProtocols = () => mobileClient && token ? ['linliao', `session.${token}`] : [];
export const mediaAccessQuery = () => mobileClient && mediaTicket ? `&access=${encodeURIComponent(mediaTicket)}` : '';
export const hasMobileSession = () => Boolean(token);
export const chooseServer = () => window.dispatchEvent(new Event('linliao:choose-server'));
