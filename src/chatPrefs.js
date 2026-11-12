import { useState } from 'react';
import { readStorage } from './history';

// 聊天显示偏好：只保存在本机。
// avatarMode：sticky = 头像跟随滚动贴在一组消息底部（Telegram 式）；top = 固定在一组消息第一条旁边。
const KEY = 'linliao.chatPrefs';
// 群聊里默认显示自己的头像、不显示自己的名字；私聊默认双方都不显示。
export const DEFAULT_CHAT_PREFS = { avatarMode: 'sticky', showSelfInGroups: true, showSelfNameInGroups: false, showBothInDirect: false, sendKey: 'enter', sound: true, quickReact: true, haptics: true };
const readPrefs = () => { const saved = readStorage(KEY, {}); return { ...DEFAULT_CHAT_PREFS, ...(saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {}) }; };
// 不在 React 里（如收到消息时）读取单项偏好。
export const chatPref = key => readPrefs()[key];
// 震动反馈（左滑回复拉过阈值、长按出菜单）：只用 navigator.vibrate，安卓有；iOS 没有这个接口，静默跳过。
export const canVibrate = () => typeof navigator.vibrate === 'function';
export function haptic() {
  if (!canVibrate() || !chatPref('haptics')) return;
  try { navigator.vibrate(10); } catch {}
}

export const modKey = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl';
// 这次按键是否表示「发送」：Enter 模式下 Enter 发送、Shift+Enter 换行；⌘Enter 模式下只有 ⌘/Ctrl+Enter 发送，Enter 换行。
export function isSendKey(event, sendKey) {
  if (event.key !== 'Enter' || event.nativeEvent?.isComposing || event.keyCode === 229) return false;
  return sendKey === 'mod-enter' ? event.metaKey || event.ctrlKey : !event.shiftKey;
}

export default function useChatPrefs() {
  const [prefs, setPrefs] = useState(readPrefs);
  const update = change => setPrefs(previous => {
    const next = { ...previous, ...change };
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch {}
    return next;
  });
  return [prefs, update];
}
