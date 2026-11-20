import './mobile/compat';
import React from 'react';
import { createRoot } from 'react-dom/client';
import MobileRoot from './mobile/MobileRoot';
import Opening from './Opening';
import ErrorBoundary from './ErrorBoundary';
import './styles.css';
import './mobile/mobile.css';
import './skins/classic.css';
import { applyTheme, storedTheme } from './useTheme';
import { applySkin, storedSkin } from './skin';
import { registerPwa } from './pwa/register';

applyTheme(storedTheme());
applySkin(storedSkin());
// 桌面端提供系统材质（液态玻璃 / 毛玻璃 / Mica / Acrylic）时，侧栏改由窗口材质透出。
if (window.desktop?.material) document.documentElement.dataset.material = window.desktop.material;

createRoot(document.getElementById('root')).render(<>
  <ErrorBoundary fallback={({ reset }) => <main className="startup-state" role="alert">
    <h2>页面遇到了意外错误</h2>
    <p>请尝试重试或刷新页面；若问题持续出现，请稍后再试。</p>
    <div className="startup-actions">
      <button type="button" className="primary-button" onClick={reset}>重试</button>
      <button type="button" className="secondary-button" onClick={() => location.reload()}>刷新页面</button>
    </div>
  </main>}><MobileRoot /></ErrorBoundary>
  <Opening />
</>);
registerPwa();
