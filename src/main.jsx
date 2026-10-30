import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { applyTheme, storedTheme } from './useTheme';

applyTheme(storedTheme());
// 桌面端提供系统材质（液态玻璃 / 毛玻璃 / Mica / Acrylic）时，侧栏改由窗口材质透出。
if (window.desktop?.material) document.documentElement.dataset.material = window.desktop.material;

createRoot(document.getElementById('root')).render(<App />);
