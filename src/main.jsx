import './mobile/compat';
import React from 'react';
import { createRoot } from 'react-dom/client';
import MobileRoot from './mobile/MobileRoot';
import './styles.css';
import './mobile/mobile.css';
import './skins/classic.css';
import './skins/qq.css';
import { applyTheme, storedTheme } from './useTheme';
import { applySkin, storedSkin } from './skin';
import { registerPwa } from './pwa/register';

applyTheme(storedTheme());
applySkin(storedSkin());
// 桌面端提供系统材质（液态玻璃 / 毛玻璃 / Mica / Acrylic）时，侧栏改由窗口材质透出。
if (window.desktop?.material) document.documentElement.dataset.material = window.desktop.material;

createRoot(document.getElementById('root')).render(<MobileRoot />);
registerPwa();
