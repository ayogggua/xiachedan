import React, { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, LoaderCircle, Server, RefreshCw } from 'lucide-react';
import App from '../App';
import { api } from '../api';
import { Logo } from '../components';
import { initializeSession, clearSession, hasMobileSession, mobileClient, mobilePlatform, serverOrigin, validateServer } from './session';
import { initializeNative, setupViewport } from './runtime';
import { MediaAccessContext } from './MediaAccessContext';

export default function MobileRoot() {
  const needsServer = mobileClient && !serverOrigin();
  const [ready, setReady] = useState(!mobileClient);
  const [choosing, setChoosing] = useState(needsServer);
  const [address, setAddress] = useState(serverOrigin());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sessionVersion, setSessionVersion] = useState(0);
  useEffect(() => {
    const cleanupViewport = setupViewport();
    if (!mobileClient) return cleanupViewport;
    document.documentElement.classList.add('mobile-app');
    document.documentElement.dataset.platform = mobilePlatform;
    let disposed = false, cleanupNative;
    initializeSession().then(() => { if (!disposed) setReady(true); }).catch(() => { if (!disposed) setError('暂时无法读取登录信息，请解锁手机后重试'); });
    initializeNative().then(cleanup => { if (disposed) cleanup(); else cleanupNative = cleanup; }).catch(() => {});
    const choose = () => { setAddress(serverOrigin()); setError(''); setChoosing(true); };
    const changed = () => setSessionVersion(version => version + 1);
    const renew = async () => {
      if (!hasMobileSession() || document.visibilityState === 'hidden') return;
      try { await api('mobile/session'); }
      catch (error) { if (error.status === 401) { await clearSession(); location.reload(); } }
    };
    const timer = setInterval(renew, 5 * 60000);
    window.addEventListener('linliao:choose-server', choose);
    window.addEventListener('linliao:mobile-session', changed);
    window.addEventListener('linliao:resume', renew);
    document.addEventListener('visibilitychange', renew);
    return () => { disposed = true; cleanupViewport(); cleanupNative?.(); clearInterval(timer); window.removeEventListener('linliao:choose-server', choose); window.removeEventListener('linliao:mobile-session', changed); window.removeEventListener('linliao:resume', renew); document.removeEventListener('visibilitychange', renew); };
  }, []);
  useEffect(() => {
    if (!choosing) return;
    const back = event => { event.preventDefault(); if (!needsServer) { setChoosing(false); setError(''); } };
    window.addEventListener('linliao:back', back);
    return () => window.removeEventListener('linliao:back', back);
  }, [choosing, needsServer]);
  async function connect(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const origin = validateServer(address);
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 12000);
      let response;
      try { response = await fetch(`${origin}/api/health`, { credentials: 'omit', signal: controller.signal }); }
      finally { clearTimeout(timeout); }
      const data = await response.json();
      if (!response.ok || data.app !== 'linliao' || data.mode !== 'cloud') throw new Error('这个地址不是可用的聊天服务器');
      if (!data.mobile) throw new Error('服务器尚未启用移动端，请先更新服务端');
      localStorage.setItem('linliao.mobile.server', origin); location.reload();
    } catch (error) { setError(error.name === 'AbortError' ? '连接超时，请检查地址和网络' : error instanceof TypeError ? '无法连接，请检查服务器地址和网络' : error.message); }
    finally { setBusy(false); }
  }
  if (choosing) return <main className="mobile-connect">
    {!needsServer && <button className="mobile-back" onClick={() => { setChoosing(false); setError(''); }}><ArrowLeft size={20} />返回</button>}
    <div className="mobile-connect-brand"><Logo /><h1>连接聊天空间</h1></div>
    <form className="mobile-connect-form" onSubmit={connect}><label htmlFor="mobile-server">服务器地址</label><div className="mobile-server-input"><Server size={18} /><input id="mobile-server" type="url" inputMode="url" autoCapitalize="none" autoCorrect="off" autoComplete="url" value={address} onChange={event => setAddress(event.target.value)} required placeholder="https://" /></div>
      {error && <p role="alert" className="form-error">{error}</p>}
      <button className="primary-button full" disabled={busy}>{busy ? <><LoaderCircle className="spin" size={18} />正在连接…</> : <>连接<ArrowRight size={18} /></>}</button>
    </form>
  </main>;
  if (!ready) return <main className="startup-state"><Logo /><p>{error || '正在打开虾扯蛋…'}</p>{error ? <button className="secondary-button" onClick={() => location.reload()}><RefreshCw size={16} />重试</button> : <LoaderCircle className="spin" size={20} />}</main>;
  return <MediaAccessContext.Provider value={sessionVersion}><App /></MediaAccessContext.Provider>;
}
