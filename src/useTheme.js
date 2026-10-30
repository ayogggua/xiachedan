import { useEffect, useState } from 'react';
import { readStorage } from './history';

export const THEMES = [['light', '浅色'], ['dark', '深色'], ['system', '跟随系统']];
const systemLight = window.matchMedia('(prefers-color-scheme: light)');

export function storedTheme() {
  const value = readStorage('linliao.theme', 'system');
  return THEMES.some(([key]) => key === value) ? value : 'system';
}

export function applyTheme(theme) {
  const light = theme === 'light' || (theme === 'system' && systemLight.matches);
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', light ? '#f7f6f4' : '#1c1c1e');
  // 让窗口的系统材质与界面深浅一致（跟随系统时交还给系统）。
  window.desktop?.setAppearance?.(theme).catch(() => {});
}

export default function useTheme() {
  const [theme, setTheme] = useState(storedTheme);
  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem('linliao.theme', JSON.stringify(theme));
    if (theme !== 'system') return;
    const follow = () => applyTheme('system');
    systemLight.addEventListener('change', follow);
    return () => systemLight.removeEventListener('change', follow);
  }, [theme]);
  return [theme, setTheme];
}
