import React, { useState } from 'react';
import { ArrowRight, ArrowLeft, Radio, ShieldCheck, Image as ImageIcon, Laptop, Check, Link2 } from 'lucide-react';
import { api, randomName } from './api';
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
  const create = bootstrap.canCreate && !bootstrap.configured && !remote;
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await api('setup', { name, avatar, spaceName });
      setCreatedInvite(await api('invite'));
    } catch (error) { setError(error.message); } finally { setBusy(false); }
  }
  return <div className="onboarding" data-screen-label="欢迎使用虾扯蛋"><div className="welcome-story"><div className="welcome-brand"><Logo /><span>虾扯蛋<span className="brand-english">XIACHEDAN</span></span></div>
    <div className="story-body"><span className="eyebrow">同网相遇，随便聊聊</span><h1>有事说事，<br />没事虾扯蛋。</h1><p className="story-description">发个想法，丢张照片，<br />和同一个网络里的朋友扯两句。</p>
      <div className="story-visual" aria-hidden="true"><div className="orbit-line" /><div className="orbit-line inner" /><div className="visual-node n1"><Laptop size={27} /></div><div className="visual-node n2"><Laptop size={27} /></div><div className="visual-node n3"><Laptop size={27} /></div><div className="visual-center"><Logo /></div><span className="visual-caption">就在同一个网络里，放轻松聊。</span></div>
    </div><div className="story-footer"><Radio size={14} /> 通过局域网连接 <span>·</span> 无需外网</div></div>
    <div className="welcome-panel"><div className="welcome-top"><span>为 Mac 而设计</span><span className="version-label">v1.3.0</span></div>
      {createdInvite ? <div className="setup-form created-view"><span className="success-icon"><Check size={28} /></span><span className="eyebrow">一切准备就绪</span><h2>欢迎来到{spaceName}</h2><p className="form-description">把这份邀请发给同一局域网里的同事，<br />粘贴一次，就能开始聊天。</p><InvitationShare invite={createdInvite} notify={notify} /><button className="secondary-button full" onClick={onJoined}>进入聊天<ArrowRight size={17} /></button></div> : <div className="setup-form">
        <span className="eyebrow">很高兴，在这里遇见你</span><h2>{remote ? '加入同事的空间' : create ? '创建你们的聊天空间' : `加入${bootstrap.workspace?.name || '聊天空间'}`}</h2><p className="form-description">{remote ? '粘贴完整邀请，地址和邀请码会自动识别。' : create ? '从一个名字开始，让同事们在这里相聚。' : '取个喜欢的昵称，粘贴邀请，就能开始聊天。'}</p>
        {bootstrap.canCreate && !bootstrap.configured && !remote && <div className="segmented-control"><button type="button" className="active">创建空间</button><button type="button" onClick={() => setRemote(true)}>加入已有空间</button></div>}
        {create ? <form onSubmit={submit}>
          <label className="field-label" htmlFor="space-name">空间名称</label><input id="space-name" value={spaceName} maxLength={32} onChange={event => setSpaceName(event.target.value)} required />
          <IdentityFields name={name} setName={setName} avatar={avatar} setAvatar={setAvatar} />
          {error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button full" disabled={busy}>{busy ? '正在创建…' : '创建空间'}<ArrowRight size={17} /></button>
        </form> : <>
          {!remote && <IdentityFields name={name} setName={setName} avatar={avatar} setAvatar={setAvatar} />}
          <JoinSpaceForm identity={{ name, avatar }} onJoined={onJoined} allowCodeOnly={!remote && bootstrap.configured} autoFocus={remote} />
        </>}
        {remote ? <button type="button" className="text-button back-link" onClick={() => setRemote(false)}><ArrowLeft size={14} />返回</button> : window.desktop && !create && <button type="button" className="text-button back-link" onClick={() => setRemote(true)}><Link2 size={14} />加入其他空间</button>}
        <div className="form-footnote"><ShieldCheck size={15} /><span>消息与文件保存在创建空间的 Mac 上</span></div>
      </div>}
      <div className="welcome-features"><span><Radio size={15} />实时聊天</span><span><ImageIcon size={15} />图片与视频</span><span><ShieldCheck size={15} />隐私模式</span></div>
    </div></div>;
}
