import React, { useState } from 'react';
import { ArrowRight, ArrowLeft, Radio, ShieldCheck, Check, Link2, KeyRound } from 'lucide-react';
import { api, randomName, nativeTitlebar } from './api';
import { Logo, IdentityFields } from './components';
import { InvitationShare, JoinSpaceForm } from './Invitation';

export default function Onboarding({ bootstrap, onJoined, notify }) {
  const [name, setName] = useState(randomName);
  const [avatar, setAvatar] = useState('cat');
  const [spaceName, setSpaceName] = useState('我们的办公室');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [createdInvite, setCreatedInvite] = useState(null);
  const [remote, setRemote] = useState(false);
  const [withCode, setWithCode] = useState(false);
  const [code, setCode] = useState('');
  async function redeem(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { await api('login-code/redeem', { code }); onJoined(); } catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  const create = bootstrap.canCreate && !bootstrap.configured && !remote;
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await api('setup', { name, avatar, spaceName });
      setCreatedInvite(await api('invite'));
    } catch (error) { setError(error.message); } finally { setBusy(false); }
  }
  return <div className={`onboarding ${nativeTitlebar ? 'native' : ''}`} data-screen-label="欢迎使用虾扯蛋">
    {nativeTitlebar && <div className="drag-strip" data-drag-region aria-hidden="true" />}
    <section className="welcome-story"><div className="welcome-brand"><Logo /><span>虾扯蛋</span></div>
      <h1>有事说事，<br />没事虾扯蛋。</h1><p className="story-description">发个想法，丢张照片，和同一个网络里的朋友扯两句。</p>
      <p className="story-footer"><Radio size={14} />通过局域网连接，无需外网</p>
    </section>
    <section className="welcome-panel glass">
      {createdInvite ? <div className="setup-form created-view"><span className="success-icon"><Check size={22} /></span><h2>欢迎来到{spaceName}</h2><p className="form-description">把这份邀请发给同一局域网里的同事，粘贴一次就能开始聊天。</p><InvitationShare invite={createdInvite} notify={notify} /><button className="secondary-button full" onClick={onJoined}>进入聊天<ArrowRight size={16} /></button></div> : <div className="setup-form">
        <h2>{withCode ? '用登录码登录' : remote ? '加入同事的空间' : create ? '创建你们的聊天空间' : `加入${bootstrap.workspace?.name || '聊天空间'}`}</h2><p className="form-description">{withCode ? `以你在「${bootstrap.workspace?.name || '这个空间'}」里已有的身份登录这台设备。` : remote ? '粘贴完整邀请，地址和邀请码会自动识别。' : create ? '从一个名字开始，让同事们在这里相聚。' : '取个喜欢的昵称，粘贴邀请，就能开始聊天。'}</p>
        {bootstrap.canCreate && !bootstrap.configured && !remote && <div className="segmented-control" role="group" aria-label="创建或加入"><button type="button" className="active" aria-pressed="true">创建空间</button><button type="button" aria-pressed="false" onClick={() => setRemote(true)}>加入已有空间</button></div>}
        {withCode ? <form onSubmit={redeem}>
          <label className="field-label" htmlFor="login-code">登录码</label><input id="login-code" autoFocus value={code} maxLength={9} placeholder="例如 K7Q2-9XMB" autoComplete="one-time-code" onChange={event => setCode(event.target.value.toUpperCase())} required />
          <p className="form-description">在已登录的设备上打开「个人资料 → 在其他设备登录」生成登录码。</p>
          {error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button full" disabled={busy || code.replace(/[\s-]/g, '').length !== 8}>{busy ? '正在登录…' : '登录'}<ArrowRight size={16} /></button>
          <button type="button" className="text-button back-link" onClick={() => { setWithCode(false); setError(''); }}><ArrowLeft size={14} />返回</button>
        </form> : create ? <form onSubmit={submit}>
          <label className="field-label" htmlFor="space-name">空间名称</label><input id="space-name" value={spaceName} maxLength={32} onChange={event => setSpaceName(event.target.value)} required />
          <IdentityFields name={name} setName={setName} avatar={avatar} setAvatar={setAvatar} />
          {error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button full" disabled={busy}>{busy ? '正在创建…' : '创建空间'}<ArrowRight size={16} /></button>
        </form> : <>
          {!remote && <IdentityFields name={name} setName={setName} avatar={avatar} setAvatar={setAvatar} />}
          <JoinSpaceForm identity={{ name, avatar }} onJoined={onJoined} allowCodeOnly={!remote && bootstrap.configured} autoFocus={remote} />
        </>}
        {!withCode && !create && !remote && bootstrap.configured && <button type="button" className="text-button back-link" onClick={() => { setWithCode(true); setError(''); }}><KeyRound size={14} />已在其他设备加入？用登录码登录</button>}
        {withCode ? null : remote ? <button type="button" className="text-button back-link" onClick={() => setRemote(false)}><ArrowLeft size={14} />返回</button> : window.desktop && !create && <button type="button" className="text-button back-link" onClick={() => setRemote(true)}><Link2 size={14} />加入其他空间</button>}
        <p className="form-footnote"><ShieldCheck size={14} />消息与文件保存在创建空间的电脑上</p>
      </div>}
    </section>
  </div>;
}
