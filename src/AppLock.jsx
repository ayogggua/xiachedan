import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Lock, LogOut } from 'lucide-react';
import { readStorage } from './history';
import { writeStorage } from './storage';
import { Logo } from './components';

// 应用锁：闲置一段时间或切到后台太久后挡住整个界面，输入本机密码才能继续看。
// 只是挡住屏幕：密码只存在这台设备（PBKDF2 摘要），不加密本机数据。需要 WebCrypto，所以局域网 http 地址上不可用。
const KEY = 'linliao.appLock';
// 忘记密码时先退出登录；确认已经退出后（下次打开是登录页）才清掉应用锁，退出失败时锁照旧。
const RESET_KEY = 'linliao.appLockReset';
const removeStorage = key => { try { localStorage.removeItem(key); } catch {} };
export function finishLockReset(loggedIn, appLock) {
  let pending = false;
  try { pending = Boolean(localStorage.getItem(RESET_KEY)); } catch {}
  if (loggedIn || !pending) return;
  removeStorage(RESET_KEY);
  appLock.disable();
}
export const LOCK_TIMEOUTS = [[1, '1 分钟'], [5, '5 分钟'], [15, '15 分钟'], [60, '1 小时']];
export const appLockSupported = () => Boolean(globalThis.crypto?.subtle) && window.isSecureContext;

const hex = buffer => [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('');
async function digest(password, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 210000 }, key, 256));
}

export function useAppLock() {
  const [config, setConfig] = useState(() => { const saved = readStorage(KEY, null); return saved?.hash && saved?.salt ? saved : null; });
  // 打开 App 时，开着应用锁就先锁上。
  const [locked, setLocked] = useState(() => Boolean(config) && appLockSupported());
  const lastActive = useRef(Date.now()), hiddenAt = useRef(0);
  const lock = useCallback(() => { if (config) setLocked(true); }, [config]);
  useEffect(() => {
    if (!config || locked) return;
    const limit = (config.minutes || 5) * 60000;
    const touch = () => { lastActive.current = Date.now(); };
    const visibility = () => {
      if (document.visibilityState === 'hidden') hiddenAt.current = Date.now();
      else if (hiddenAt.current && Date.now() - hiddenAt.current >= limit) setLocked(true);
    };
    const timer = setInterval(() => { if (Date.now() - lastActive.current >= limit) setLocked(true); }, 10000);
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
    for (const name of events) window.addEventListener(name, touch, { passive: true });
    document.addEventListener('visibilitychange', visibility);
    touch();
    return () => { clearInterval(timer); for (const name of events) window.removeEventListener(name, touch); document.removeEventListener('visibilitychange', visibility); };
  }, [config, locked]);
  const save = next => { if (next) writeStorage(KEY, JSON.stringify(next)); else removeStorage(KEY); setConfig(next); };
  const enable = async (password, minutes) => {
    const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
    save({ salt, hash: await digest(password, salt), minutes });
  };
  const verify = async password => Boolean(config) && await digest(password, config.salt) === config.hash;
  const unlock = async password => { if (!await verify(password)) return false; removeStorage(RESET_KEY); lastActive.current = Date.now(); setLocked(false); return true; };
  return { enabled: Boolean(config), minutes: config?.minutes || 5, locked: locked && Boolean(config), lock, unlock, verify, enable,
    setMinutes: minutes => config && save({ ...config, minutes }), disable: () => { save(null); setLocked(false); } };
}

export function LockScreen({ appLock, onLogout, loggingOut }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef(null);
  const input = useRef(null);
  const mounted = useRef(true);
  const lockedRef = useRef(appLock.locked);
  lockedRef.current = appLock.locked;
  useEffect(() => {
    mounted.current = true;
    const el = dialogRef.current;
    if (el && !el.open) el.showModal();
    input.current?.focus();
    const onKeyDown = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      mounted.current = false;
      window.removeEventListener('keydown', onKeyDown, true);
      if (el?.open) el.close();
    };
  }, []);
  async function submit(event) {
    event.preventDefault();
    if (!password || busy) return;
    setBusy(true); setError('');
    // 连续输错时稍等一下再允许重试。
    const ok = await appLock.unlock(password);
    if (!ok) { setError('密码不对'); setPassword(''); await new Promise(resolve => setTimeout(resolve, 600)); }
    setBusy(false);
    if (!ok) input.current?.focus();
  }
  return <dialog ref={dialogRef} className="lock-screen" closedby="none" aria-label="虾扯蛋已锁定"
    onCancel={event => { event.preventDefault(); event.stopPropagation(); }}
    onClose={() => {
      if (mounted.current && lockedRef.current && dialogRef.current && !dialogRef.current.open) {
        dialogRef.current.showModal();
        input.current?.focus();
      }
    }}>
    <form className="lock-card" onSubmit={submit}>
      <Logo />
      <h2><Lock size={16} />虾扯蛋已锁定</h2>
      <input ref={input} type="password" aria-label="应用锁密码" placeholder="输入密码解锁" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} />
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="primary-button full" disabled={!password || busy}>解锁</button>
      <button type="button" className="text-button" disabled={loggingOut} onClick={() => { writeStorage(RESET_KEY, '1'); onLogout(); }}><LogOut size={13} />忘记密码？退出登录</button>
    </form>
  </dialog>;
}
