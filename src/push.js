// 手机推送（PWA）：只在装了 Service Worker 的安全页面里可用；桌面端用系统通知，手机 App 暂不支持。
import { api } from './api';
import { mobileClient } from './mobile/session';
import { readStorage } from './history';

const KEY = 'linliao.push';
export const pushSupported = () => import.meta.env.MODE === 'pwa' && !window.desktop && !mobileClient && window.isSecureContext
  && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
// iPhone、iPad 上只有「添加到主屏幕」后打开才有推送。
export const needsHomeScreen = () => !pushSupported() && import.meta.env.MODE === 'pwa' && /iPhone|iPad|iPod/.test(navigator.userAgent) && !navigator.standalone;
export const pushState = () => readStorage(KEY, null);
export const pushId = () => pushState()?.id || '';

const keyBytes = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
const sameKey = (buffer, bytes) => buffer && new Uint8Array(buffer).every((byte, index) => byte === bytes[index]) && buffer.byteLength === bytes.length;

async function subscription() {
  const registration = await navigator.serviceWorker.ready;
  const current = await registration.pushManager.getSubscription();
  const key = keyBytes((await api('push')).publicKey);
  // 服务端换了签名密钥时，旧订阅收不到推送，重新订阅。
  if (current && sameKey(current.options?.applicationServerKey, key)) return current;
  await current?.unsubscribe();
  return registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
}

async function upload(item, settings) {
  const { id } = await api('push/subscribe', { subscription: item.toJSON(), muted: settings.muted, private: settings.private });
  localStorage.setItem(KEY, JSON.stringify({ id, endpoint: item.endpoint }));
  return id;
}

// 打开推送：必须在点击里调用（浏览器要求用户手势）。
export async function enablePush(settings) {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error(permission === 'denied' ? '通知权限被拒绝，请在系统设置里允许虾扯蛋发送通知' : '没有获得通知权限');
  return upload(await subscription(), settings);
}

export async function disablePush() {
  const state = pushState();
  if (!state) return;
  localStorage.removeItem(KEY);
  await api('push/unsubscribe', { endpoint: state.endpoint }).catch(() => {});
  const registration = await navigator.serviceWorker?.getRegistration().catch(() => null);
  await (await registration?.pushManager?.getSubscription())?.unsubscribe().catch(() => {});
}

// 免打扰、隐私模式变化后同步给服务端；系统里关掉了通知权限就当作已关闭。
export async function syncPush(settings) {
  if (!pushSupported() || !pushState()) return;
  if (Notification.permission !== 'granted') { localStorage.removeItem(KEY); return; }
  const item = await subscription();
  await upload(item, settings);
}
