import { useEffect, useState } from 'react';
import { readStorage } from './history';

// 界面风格只保存在本机。经典和 QQ 共用三栏骨架，QQ 的外观覆盖见 skins/qq.css。
export const SKINS = [['xiachedan', '虾扯蛋'], ['classic', '经典'], ['qq', 'QQ']];

export function storedSkin() {
  const value = readStorage('linliao.skin', 'xiachedan');
  return SKINS.some(([key]) => key === value) ? value : 'xiachedan';
}

export function applySkin(skin) {
  delete document.documentElement.dataset.style;
  if (skin === 'classic') document.documentElement.dataset.skin = 'classic';
  else if (skin === 'qq') {
    document.documentElement.dataset.skin = 'classic';
    document.documentElement.dataset.style = 'qq';
  } else delete document.documentElement.dataset.skin;
  // 桌面端：三栏风格把 macOS 红绿灯挪进导航栏（旧版桌面端没有这个接口）。
  window.desktop?.setSkin?.(skin).catch(() => {});
}

export default function useSkin() {
  const [skin, setSkin] = useState(storedSkin);
  useEffect(() => {
    applySkin(skin);
    localStorage.setItem('linliao.skin', JSON.stringify(skin));
  }, [skin]);
  return [skin, setSkin];
}
