import { useEffect, useState } from 'react';
import { readStorage } from './history';

// 主题色和消息字号：只保存在本机。主题色按深浅主题分别推算出按钮底色和文字色，保证对比度达标。
export const ACCENTS = [['橙', null], ['蓝', '#3b82f6'], ['青', '#14b8a6'], ['绿', '#22a35a'], ['紫', '#8b5cf6'], ['粉', '#e8508f'], ['红', '#e5484d'], ['金', '#d4a017']];
export const FONT_SIZES = [['小', 13], ['标准', 14], ['大', 16], ['特大', 18]];

const toRgb = hex => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
const toHex = rgb => `#${rgb.map(value => Math.round(Math.max(0, Math.min(255, value))).toString(16).padStart(2, '0')).join('')}`;
const luminance = rgb => rgb.map(value => value / 255).map(value => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
  .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const mix = (rgb, target, amount) => rgb.map((value, index) => value + (target[index] - value) * amount);
// 朝黑或白一点点调，直到与背景的对比度达到 4.5。
function readable(rgb, background, toward) {
  for (let amount = 0; amount <= 1; amount += 0.02) { const next = mix(rgb, toward, amount); if (contrast(next, background) >= 4.5) return next; }
  return toward;
}

export function applyAppearance({ accent, fontSize }) {
  const root = document.documentElement.style;
  root.setProperty('--chat-font', `${fontSize}px`);
  for (const name of ['--accent', '--accent-bright', '--accent-icon', '--mention']) root.removeProperty(name);
  if (!accent || !/^#[0-9a-f]{6}$/i.test(accent)) return;
  const light = document.documentElement.dataset.theme === 'light';
  const base = toRgb(accent), white = [255, 255, 255], black = [0, 0, 0];
  const text = readable(base, light ? toRgb('#f7f6f4') : toRgb('#1c1c1e'), light ? black : white);
  root.setProperty('--accent', toHex(readable(base, white, black)));
  root.setProperty('--accent-icon', accent);
  root.setProperty('--accent-bright', toHex(text));
  root.setProperty('--mention', toHex(text));
}

export function readAppearance() {
  const saved = readStorage('linliao.appearance', {});
  return { accent: typeof saved.accent === 'string' ? saved.accent : null, fontSize: FONT_SIZES.some(([, size]) => size === saved.fontSize) ? saved.fontSize : 14 };
}

export default function useAppearance() {
  const [appearance, setAppearance] = useState(readAppearance);
  useEffect(() => {
    localStorage.setItem('linliao.appearance', JSON.stringify(appearance));
    applyAppearance(appearance);
    // 深浅主题切换时重新推算文字色。
    const observer = new MutationObserver(() => applyAppearance(appearance));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, [appearance]);
  return [appearance, setAppearance];
}
