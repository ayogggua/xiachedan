import { useEffect, useState } from 'react';
import { readStorage } from './history';

// 界面风格：虾扯蛋（玻璃风）与经典（熟悉的三栏聊天布局），只保存在本机。经典风格的样式见 skins/classic.css。
export const SKINS = [['xiachedan', '虾扯蛋'], ['classic', '经典']];

export function storedSkin() {
  const value = readStorage('linliao.skin', 'xiachedan');
  return SKINS.some(([key]) => key === value) ? value : 'xiachedan';
}

export function applySkin(skin) {
  if (skin === 'classic') document.documentElement.dataset.skin = 'classic';
  else delete document.documentElement.dataset.skin;
  // 桌面端：经典风格把 macOS 红绿灯挪进导航栏（旧版桌面端没有这个接口）。
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
