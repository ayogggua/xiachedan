import React, { useId, useRef, useState } from 'react';
import { ArrowRight, Copy, Laptop } from 'lucide-react';
import { api, randomName } from './api';
import { formatInvitation, parseInvitation } from '../shared/invitation';

export function InvitationShare({ invite, notify }) {
  const text = formatInvitation(invite);
  const fieldId = useId();
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      if (window.desktop) await window.desktop.copy(text);
      else await navigator.clipboard.writeText(text);
      setCopied(true);
      notify('整份邀请已复制，同事粘贴一次即可加入');
    } catch { notify('请选中邀请信息，按 Command + C 复制'); }
  }
  return <div className="invitation-share">
    {text ? <><label className="field-label" htmlFor={fieldId}>空间邀请</label>
      <textarea id={fieldId} className="invitation-text" value={text} readOnly rows={5} onFocus={event => event.target.select()} />
      <p className="inline-note">同事打开虾扯蛋，选择「加入空间」，粘贴这整段邀请就能进来。</p>
      <button type="button" className="primary-button full" onClick={copy}><Copy size={16} />{copied ? '再次复制邀请' : '复制邀请'}</button>
      <details className="invitation-details"><summary>查看地址和邀请码</summary>
        <div className="invitation-addresses">{invite.addresses.map(address => <span key={address}>{address}</span>)}</div>
        <span>邀请码：{invite.code}</span>
      </details>
    </> : <p className="inline-note">尚未检测到可用的局域网地址，请连接 Wi-Fi 或有线网络。</p>}
    <p className="host-note"><Laptop size={16} />创建空间的电脑需要保持虾扯蛋运行。</p>
  </div>;
}

export function JoinSpaceForm({ identity, onJoined, allowCodeOnly = false, autoFocus = false }) {
  const fieldId = useId();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fallbackIdentity = useRef(null);
  const pending = useRef(false);
  if (!fallbackIdentity.current) fallbackIdentity.current = { name: randomName(), avatar: 'cat' };
  async function join(text) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true); setError('');
    try {
      const invite = parseInvitation(text);
      const profile = identity || fallbackIdentity.current;
      if (invite.addresses.length && window.desktop) {
        await window.desktop.connect(text, { name: profile.name, avatar: profile.avatar });
      } else if (invite.inviteCode && (allowCodeOnly && !invite.addresses.length || invite.addresses.includes(location.origin))) {
        await api('join', { ...profile, inviteCode: invite.inviteCode });
        await onJoined?.();
      } else if (window.desktop) {
        throw new Error('请复制包含内网地址的完整邀请');
      } else {
        throw new Error('请先在浏览器打开邀请中的内网地址，或在虾扯蛋桌面应用中粘贴完整邀请');
      }
    } catch (error) { setError(error.message); }
    finally { pending.current = false; setBusy(false); }
  }
  function paste(event) {
    const text = event.clipboardData.getData('text/plain').trim();
    if (!text || busy) return;
    event.preventDefault(); setValue(text);
    try {
      const invite = parseInvitation(text);
      if (invite.inviteCode && (invite.addresses.length || allowCodeOnly)) void join(text);
      else setError('');
    } catch (error) { setError(error.message); }
  }
  return <form className="join-space-form" onSubmit={event => { event.preventDefault(); void join(value); }}>
    <label className="field-label" htmlFor={fieldId}>邀请信息{allowCodeOnly ? '或邀请码' : ''}</label>
    <textarea id={fieldId} className="invitation-text invitation-input" placeholder="在这里粘贴同事发来的完整邀请" rows={4}
      value={value} maxLength={4096} required autoFocus={autoFocus} readOnly={busy} aria-busy={busy}
      onChange={event => { setValue(event.target.value); setError(''); }} onPaste={paste} />
    <p className="inline-note">粘贴完整邀请后自动加入。昵称和头像可以随时修改。</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="primary-button full" disabled={busy || !value.trim()}>{busy ? '正在加入…' : '加入空间'}<ArrowRight size={16} /></button>
  </form>;
}
