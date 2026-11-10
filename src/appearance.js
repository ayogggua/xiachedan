import { useEffect, useState } from 'react';
import { readStorage } from './history';

// 主题色和消息字号：只保存在本机。主题色按深浅主题分别推算出按钮底色和文字色，保证对比度达标。
export const ACCENTS = [['橙', null], ['蓝', '#3b82f6'], ['青', '#14b8a6'], ['绿', '#22a35a'], ['紫', '#8b5cf6'], ['粉', '#e8508f'], ['红', '#e5484d'], ['金', '#d4a017']];
export const FONT_SIZES = [['小', 13], ['标准', 14], ['大', 16], ['特大', 18]];
// 聊天背景：用 CSS 画的渐变和细图案，浅色、深色各一套；也可以用自己的图片（只存在本机）。
export const WALLPAPERS = [
  ['none', '无'],
  ['mist', '晨雾', 'linear-gradient(160deg, #e6eee8, #f4e9de)', 'linear-gradient(160deg, #1d2724, #29211d)'],
  ['bay', '海湾', 'linear-gradient(180deg, #dce8f2, #eef3f6)', 'linear-gradient(180deg, #152029, #1d252e)'],
  ['dusk', '暮光', 'radial-gradient(circle at 20% 15%, #f3dbe6, transparent 55%), radial-gradient(circle at 85% 80%, #dcdcf5, transparent 55%), #f3eff2', 'radial-gradient(circle at 20% 15%, #3a2433, transparent 55%), radial-gradient(circle at 85% 80%, #232845, transparent 55%), #1b1a20'],
  ['dots', '点阵', 'radial-gradient(rgba(60, 50, 40, .12) 1px, transparent 1.6px) 0 0 / 18px 18px, #f2efe9', 'radial-gradient(rgba(255, 255, 255, .08) 1px, transparent 1.6px) 0 0 / 18px 18px, #1c1c1e'],
  ['lines', '斜纹', 'repeating-linear-gradient(45deg, rgba(60, 50, 40, .05) 0 2px, transparent 2px 14px), #f3f0ea', 'repeating-linear-gradient(45deg, rgba(255, 255, 255, .04) 0 2px, transparent 2px 14px), #1d1c1f'],
  ['paper', '纸张', 'linear-gradient(rgba(255, 252, 240, .6), rgba(255, 252, 240, .6)), #ede6d6', 'linear-gradient(rgba(40, 36, 30, .6), rgba(40, 36, 30, .6)), #2a2620'],
];
export const wallpaperCss = (id, light, image) => {
  if (id === 'custom') return image ? `${light ? 'linear-gradient(rgba(255, 255, 255, .12), rgba(255, 255, 255, .12))' : 'linear-gradient(rgba(0, 0, 0, .4), rgba(0, 0, 0, .4))'}, center / cover no-repeat url("${image}")` : null;
  const preset = WALLPAPERS.find(([key]) => key === id);
  return preset?.[2] ? (light ? preset[2] : preset[3]) : null;
};
const WALLPAPER_IMAGE = 'linliao.wallpaperImage';
export const readWallpaperImage = () => { try { return localStorage.getItem(WALLPAPER_IMAGE); } catch { return null; } };
// 自定义背景图在本机缩到长边 1600、存成 JPEG，几百 KB 以内。
export async function saveWallpaperImage(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const data = canvas.toDataURL('image/jpeg', 0.8);
  localStorage.setItem(WALLPAPER_IMAGE, data);
  return data;
}

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

// 经典风格默认用绿色；选「橙」时存的是 null，按橙色推算。
export const CLASSIC_ACCENT = '#22a35a';
const DEFAULT_ACCENT = '#d9653f';
const INK = [17, 17, 17];

export function applyAppearance({ accent, fontSize, wallpaper }) {
  const root = document.documentElement.style;
  const valid = Boolean(accent) && /^#[0-9a-f]{6}$/i.test(accent);
  // 经典风格自己的气泡：浅色模式用主题色的浅色调，深色模式用主题色本身，都配深色文字并保证对比度不低于 4.5。
  const lightTheme = document.documentElement.dataset.theme === 'light';
  const outBase = toRgb(valid ? accent : DEFAULT_ACCENT);
  root.setProperty('--bubble-out', toHex(readable(lightTheme ? mix(outBase, [255, 255, 255], .5) : outBase, INK, [255, 255, 255])));
  root.setProperty('--chat-font', `${fontSize}px`);
  const background = wallpaperCss(wallpaper, document.documentElement.dataset.theme === 'light', wallpaper === 'custom' ? readWallpaperImage() : null);
  if (background) { root.setProperty('--wallpaper', background); document.documentElement.dataset.wallpaper = wallpaper; }
  else { root.removeProperty('--wallpaper'); delete document.documentElement.dataset.wallpaper; }
  for (const name of ['--accent', '--accent-bright', '--accent-icon', '--mention']) root.removeProperty(name);
  if (!valid) return;
  const light = document.documentElement.dataset.theme === 'light';
  const base = toRgb(accent), white = [255, 255, 255], black = [0, 0, 0];
  const text = readable(base, light ? toRgb('#f7f6f4') : toRgb('#1c1c1e'), light ? black : white);
  root.setProperty('--accent', toHex(readable(base, white, black)));
  root.setProperty('--accent-icon', accent);
  root.setProperty('--accent-bright', toHex(text));
  root.setProperty('--mention', toHex(text));
}

const validWallpaper = value => value === 'custom' || WALLPAPERS.some(([key]) => key === value) ? value : 'none';
// 主题色和聊天背景每种界面风格各记一份（经典的存在 classic 里），消息字号共用。
export function readAppearance() {
  const saved = readStorage('linliao.appearance', {});
  const classic = saved.classic && typeof saved.classic === 'object' ? saved.classic : {};
  return { accent: typeof saved.accent === 'string' ? saved.accent : null, fontSize: FONT_SIZES.some(([, size]) => size === saved.fontSize) ? saved.fontSize : 14,
    wallpaper: validWallpaper(saved.wallpaper),
    classic: { accent: 'accent' in classic ? typeof classic.accent === 'string' ? classic.accent : null : CLASSIC_ACCENT, wallpaper: validWallpaper(classic.wallpaper) } };
}

export default function useAppearance(skin) {
  const [stored, setStored] = useState(readAppearance);
  const current = skin === 'classic' ? stored.classic : stored;
  const { accent, wallpaper } = current, { fontSize } = stored;
  useEffect(() => { localStorage.setItem('linliao.appearance', JSON.stringify(stored)); }, [stored]);
  useEffect(() => {
    const appearance = { accent, fontSize, wallpaper };
    applyAppearance(appearance);
    // 深浅主题切换时重新推算文字色。
    const observer = new MutationObserver(() => applyAppearance(appearance));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, [accent, fontSize, wallpaper]);
  const setAppearance = next => setStored(previous => skin === 'classic'
    ? { ...previous, fontSize: next.fontSize, classic: { accent: next.accent, wallpaper: next.wallpaper } }
    : { ...previous, accent: next.accent, fontSize: next.fontSize, wallpaper: next.wallpaper });
  return [{ accent, fontSize, wallpaper }, setAppearance];
}
