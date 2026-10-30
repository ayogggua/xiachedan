import React, { useRef, useState, useEffect } from 'react';
import { Camera, Check, Search, Users, ArrowRight, Wifi, ExternalLink, Bell } from 'lucide-react';
import { api, upload, formatSize } from './api';
import { Modal, Avatar, IdentityFields } from './components';
import { InvitationShare, JoinSpaceForm } from './Invitation';

export function ProfileDialog({ me, onClose, onUpdate, notify }) {
  const [name, setName] = useState(me.name);
  const [avatar, setAvatar] = useState(me.avatar);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileInput = useRef();
  async function save(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { const { me: updated } = await api('profile', { name, avatar }); onUpdate(updated); onClose(); notify('个人资料已更新'); }
    catch (error) { setError(error.message); } finally { setBusy(false); }
  }
  async function avatarUpload(file) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return setError('头像不能超过 5 MB');
    setBusy(true); setError('');
    try { const result = await upload(file, { purpose: 'avatar' }); setAvatar(result.me.avatar); onUpdate(result.me); notify('头像已更新'); }
    catch (error) { setError(error.message); } finally { setBusy(false); }
  }
  return <Modal title="做自己，或者做只小猫" subtitle="昵称和头像，随时都能换一个心情。" onClose={onClose}><form onSubmit={save}><div className="profile-avatar"><Avatar user={{ avatar }} size={88} /><button type="button" className="secondary-button" onClick={() => fileInput.current.click()} disabled={busy}><Camera size={16} />上传头像</button><small>JPG、PNG、GIF、WebP · 最大 5 MB</small></div><input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={event => { avatarUpload(event.target.files[0]); event.target.value = ''; }} /><IdentityFields {...{ name, setName, avatar, setAvatar }} />{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-footer"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={busy}>{busy ? '正在保存…' : '保存修改'}</button></div></form></Modal>;
}

export function InviteDialog({ onClose, notify }) {
  const [invite, setInvite] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api('invite').then(setInvite).catch(error => setError(error.message)); }, []);
  return <Modal title="喊上同事，一起扯两句" subtitle="复制一份邀请，同事粘贴一次就能加入。" onClose={onClose}>
    {error && <p className="form-error" role="alert">{error}</p>}
    {invite ? <InvitationShare invite={invite} notify={notify} /> : !error && <p className="inline-note">正在获取邀请信息…</p>}
  </Modal>;
}

export function GroupDialog({ users, me, room, onClose, onCreated, notify }) {
  const [name, setName] = useState('');
  const [selected, setSelected] = useState([]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const candidates = users.filter(user => user.id !== me.id && !room?.members.includes(user.id));
  const filtered = candidates.filter(user => user.name.toLowerCase().includes(search.toLowerCase()));
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = room ? await api('room-members', { roomId: room.id, memberIds: selected }) : await api('rooms', { name, memberIds: selected });
      await onCreated(result.id || room.id); onClose(); notify(room ? '成员已加入群聊' : '群聊已创建');
    } catch (error) { setError(error.message); } finally { setBusy(false); }
  }
  return <Modal title={room ? `邀请成员加入${room.name}` : '把大家聚在一起'} subtitle={room ? '新成员加入后可以查看群聊历史消息。' : '创建一个群聊，让话题有自己的小天地。'} onClose={onClose}><form onSubmit={submit}>
    {!room && <><label className="field-label" htmlFor="group-name">群聊名称</label><input id="group-name" placeholder="例如：午饭研究所" value={name} maxLength={24} onChange={event => setName(event.target.value)} required /></>}
    <div className="field-label group-select-label"><span>选择成员</span><small>已选 {selected.length} 人</small></div><div className="search-input"><Search size={16} /><input placeholder="搜索昵称" aria-label="搜索群成员" value={search} onChange={event => setSearch(event.target.value)} /></div>
    <div className="member-picker">{filtered.map(user => <label className="member-option" key={user.id}><input type="checkbox" checked={selected.includes(user.id)} onChange={event => setSelected(previous => event.target.checked ? [...previous, user.id] : previous.filter(id => id !== user.id))} /><Avatar user={user} size={36} online={user.online} /><span>{user.name}<small>{user.online ? '在线' : '离线'}</small></span><span className={`selection-check ${selected.includes(user.id) ? 'checked' : ''}`}>{selected.includes(user.id) && <Check size={13} />}</span></label>)}{!filtered.length && <div className="compact-empty"><Users size={25} /><p>{candidates.length ? '没有找到这个昵称' : room ? '空间里的成员都已在群中' : '还没有其他成员，先邀请同事加入空间吧'}</p></div>}</div>
    {error && <p className="form-error" role="alert">{error}</p>}<div className="modal-footer"><button className="secondary-button" type="button" onClick={onClose}>取消</button><button className="primary-button" disabled={busy || !selected.length}>{busy ? '处理中…' : room ? '邀请加入' : '创建群聊'}<ArrowRight size={16} /></button></div>
  </form></Modal>;
}

function DesktopSettings({ notify }) {
  const [settings, setSettings] = useState(null);
  useEffect(() => {
    let cancelled = false;
    window.desktop.getState().then(value => { if (!cancelled) setSettings(value); }).catch(error => notify(error.message));
    const unsubscribe = window.desktop.onEvent(value => { if (value.type === 'settings') setSettings(value); });
    return () => { cancelled = true; unsubscribe(); };
  }, [notify]);
  async function toggle() {
    try { setSettings(await window.desktop.settings({ notificationsEnabled: !settings.notificationsEnabled })); }
    catch (error) { notify(error.message); }
  }
  async function test() {
    try {
      const shown = await window.desktop.testNotification();
      notify(shown ? '已发送测试提醒；未弹出时请检查 macOS 通知设置。' : '提醒未能发送，请检查 macOS 通知设置。');
    } catch (error) { notify(error.message); }
  }
  if (!settings) return null;
  return <section className="desktop-settings" aria-label="菜单栏与提醒">
    <div className="notification-setting"><Bell size={18} /><span><b>新消息弹窗提醒</b><small>窗口关闭后，虾扯蛋仍会在菜单栏接收消息。</small></span><button type="button" role="switch" aria-label="新消息弹窗提醒" aria-checked={settings.notificationsEnabled} className={`switch ${settings.notificationsEnabled ? 'enabled' : ''}`} onClick={toggle}><i className="switch-track"><i /></i></button></div>
    <p className="inline-note">首次使用请允许通知。隐私模式下，通知内容也只显示 ****。</p>
    <div className="notification-actions"><button className="secondary-button" type="button" onClick={test} disabled={!settings.notificationsEnabled || !settings.notificationSupported}>测试提醒</button><button className="text-button" type="button" onClick={() => window.desktop.notificationSettings().catch(error => notify(error.message))}>macOS 通知设置<ExternalLink size={13} /></button></div>
    {settings.notificationError && <p className="form-error" role="alert">{settings.notificationError}</p>}
  </section>;
}

export function ConnectionDialog({ connected, me, workspace, onCleared, onClose, notify }) {
  return <Modal title="连接与空间" subtitle="所有聊天都通过局域网连接。" onClose={onClose}>
    <div className="connection-card"><Wifi size={22} /><div><b>{connected ? '已连接到聊天空间' : '正在尝试重新连接'}</b><span>{location.origin}</span></div><i className={connected ? 'online' : ''} /></div>
    <p className="inline-note">消息和附件保存在创建空间的 Mac 上。隐私模式用于遮挡屏幕内容；局域网传输使用 HTTP，请在可信网络内使用。</p>
    {workspace.ownerId === me.id && <StorageSettings onCleared={onCleared} notify={notify} />}
    {window.desktop && <>{window.desktop.getState && <DesktopSettings notify={notify} />}
      <h3 className="join-space-heading">加入另一个空间</h3><JoinSpaceForm identity={me} />
      <button type="button" className="text-button back-link" onClick={() => window.desktop.home().catch(error => notify(error.message))}>返回本机空间</button>
    </>}
  </Modal>;
}

export function RemoveMemberDialog({ user, onClose, onRemoved }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function remove() {
    if (busy) return;
    setBusy(true); setError('');
    try { await api('remove-member', { userId: user.id }); await onRemoved(); }
    catch (error) { setError(error.message); setBusy(false); }
  }
  return <Modal title={`从空间移除「${user.name}」？`} subtitle="对方将断开连接，无法继续访问这个空间。历史消息会保留，原邀请码将失效，需要邀请新人时请重新复制邀请。" onClose={() => !busy && onClose()}>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="modal-footer"><button className="secondary-button" disabled={busy} onClick={onClose}>取消</button><button className="primary-button danger-button" disabled={busy} onClick={remove}>{busy ? '正在移除…' : '确认移除'}</button></div>
  </Modal>;
}

export function RecallDialog({ message, onClose, onRecalled }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function recall() {
    if (busy) return;
    setBusy(true); setError('');
    try { const result = await api('recall-message', { messageId: message.id }); onRecalled(result.message); }
    catch (error) { setError(error.message); setBusy(false); }
  }
  return <Modal title="撤回这条消息？" subtitle="撤回后，所有成员将看到撤回提示，原来的文字、图片和视频不再提供查看。" onClose={() => !busy && onClose()}>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="modal-footer"><button className="secondary-button" disabled={busy} onClick={onClose}>取消</button><button className="primary-button" disabled={busy} onClick={recall}>{busy ? '正在撤回…' : '确认撤回'}</button></div>
  </Modal>;
}

function StorageSettings({ onCleared, notify }) {
  const [info, setInfo] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { api('storage').then(setInfo).catch(error => setError(error.message)); }, []);
  const size = bytes => bytes === 0 ? '0 KB' : formatSize(bytes);
  async function clear() {
    if (busy || confirmation !== '清空') return;
    setBusy(true); setError('');
    try {
      const result = await api('clear-history', { confirmation }, { signal: AbortSignal.timeout(120000) });
      setInfo(result.storage); setConfirming(false); setConfirmation(''); await onCleared(result);
      notify(`记录已清空，释放 ${size(result.freedBytes)}`);
      if (!result.compacted || result.storage.pendingBytes) setError('聊天记录已删除，部分磁盘空间暂未释放，请稍后再次清理。');
    } catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  return <section className="storage-settings"><h3>聊天记录与存储</h3>
    <p className="inline-note">{info ? `${info.messageCount} 条记录 · 聊天附件 ${size(info.attachmentBytes)} · 数据库 ${size(info.databaseBytes)}` : '正在统计空间占用…'}</p>
    <p className="inline-note">清空整个空间所有会话的聊天记录及已发送的图片、视频，释放创建空间的 Mac 上的存储。成员、头像和群聊会保留。</p>
    <button className="secondary-button storage-clear-button" disabled={!info || busy} onClick={() => setConfirming(true)}>清空空间聊天记录</button>
    {error && <p className="form-error" role="alert">{error}</p>}
    {confirming && <Modal title="清空整个空间的聊天记录？" subtitle="所有成员的大厅、群聊和私聊记录都会删除，图片与视频文件也会删除。此操作无法恢复。" onClose={() => !busy && setConfirming(false)}>
      <label className="field-label" htmlFor="clear-history-confirm">输入“清空”以确认</label><input id="clear-history-confirm" value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy} autoComplete="off" />
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-footer"><button className="secondary-button" disabled={busy} onClick={() => setConfirming(false)}>取消</button><button className="primary-button danger-button" disabled={busy || confirmation !== '清空'} onClick={clear}>{busy ? '正在清理…' : '确认清空'}</button></div>
    </Modal>}
  </section>;
}
