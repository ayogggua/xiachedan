import { copyText } from './mobile/runtime';
import React, { useRef, useState, useEffect } from 'react';
import { Camera, Check, Search, Users, Hash, ArrowRight, Copy, Bot } from 'lucide-react';
import { api, upload, formatSize, absoluteUrl, mediaUrl, formatTime } from './api';
import { FormattedText } from './markdown';
import { Modal, Avatar, AvatarPicker, IdentityFields } from './components';
import { InvitationShare } from './Invitation';
import { modKey } from './chatPrefs';

export function ProfileDialog({ me, onClose, onUpdate, notify }) {
  const [name, setName] = useState(me.name);
  const [avatar, setAvatar] = useState(me.avatar);
  const [department, setDepartment] = useState(me.department || '');
  const [bio, setBio] = useState(me.bio || '');
  const [color, setColor] = useState(Number.isInteger(me.nameColor) ? me.nameColor : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileInput = useRef();
  async function save(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { const { me: updated } = await api('profile', { name, avatar, department, bio, nameColor: color }); onUpdate(updated); onClose(); notify('个人资料已更新'); }
    catch (error) { setError(error.message); } finally { setBusy(false); }
  }
  async function avatarUpload(file) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return setError('头像不能超过 5 MB');
    setBusy(true); setError('');
    try { const result = await upload(file, { purpose: 'avatar' }); setAvatar(result.me.avatar); onUpdate(result.me); notify('头像已更新'); }
    catch (error) { setError(error.message); } finally { setBusy(false); }
  }
  return <Modal title="做自己，或者做只小猫" subtitle="昵称和头像，随时都能换一个心情。" onClose={onClose}><form onSubmit={save}><div className="profile-avatar"><Avatar user={{ avatar }} size={88} /><button type="button" className="secondary-button" onClick={() => fileInput.current.click()} disabled={busy}><Camera size={16} />上传头像</button><small>JPG、PNG、GIF、WebP · 最大 5 MB</small></div><input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={event => { avatarUpload(event.target.files[0]); event.target.value = ''; }} /><IdentityFields {...{ name, setName, avatar, setAvatar }} /><span className="field-label">名字颜色</span><div className="accent-row name-colors" role="radiogroup" aria-label="名字颜色"><button type="button" role="radio" aria-checked={color === null} className={`name-color-auto ${color === null ? 'active' : ''}`} onClick={() => setColor(null)}>自动</button>{[0, 1, 2, 3, 4, 5, 6].map(index => <button type="button" key={index} role="radio" aria-checked={color === index} aria-label={`名字颜色 ${index + 1}`} className={`accent-swatch ${color === index ? 'active' : ''}`} style={{ background: `var(--name-${index})` }} onClick={() => setColor(index)} />)}<b className="name-color-preview" style={{ color: color === null ? 'var(--text-1)' : `var(--name-${color})` }}>{name || '名字'}</b></div><label className="field-label" htmlFor="profile-department">部门（可选）</label><input id="profile-department" value={department} maxLength={40} placeholder="例如：设计部" onChange={event => setDepartment(event.target.value)} /><label className="field-label" htmlFor="profile-bio">签名（可选）</label><input id="profile-bio" value={bio} maxLength={120} placeholder="一句话介绍自己" onChange={event => setBio(event.target.value)} />{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-footer"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={busy}>{busy ? '正在保存…' : '保存修改'}</button></div></form></Modal>;
}

export function InviteDialog({ cloud, onClose, notify }) {
  const [invite, setInvite] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api('invite').then(setInvite).catch(error => setError(error.message)); }, []);
  return <Modal title="喊上同事，一起扯两句" subtitle={cloud ? '分享注册链接，管理员审核通过后即可加入。' : '复制一份邀请，同事粘贴一次就能加入。'} onClose={onClose}>
    {error && <p className="form-error" role="alert">{error}</p>}
    {invite ? cloud ? <div className="cloud-invite"><input aria-label="注册链接" value={invite.url || absoluteUrl('')} readOnly onFocus={event => event.target.select()} /><button className="primary-button full" onClick={() => copyText(invite.url || absoluteUrl('')).then(() => notify('注册链接已复制')).catch(() => setError('复制失败，请选中上方链接复制'))}><Copy size={15} />复制注册链接</button></div> : <InvitationShare invite={invite} notify={notify} /> : !error && <p className="inline-note">正在获取邀请信息…</p>}
  </Modal>;
}

export function RoomAvatarDialog({ room, onClose, onSaved, notify }) {
  const [avatar, setAvatar] = useState(room.avatar || null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileInput = useRef();
  useEffect(() => {
    if (!file) { setPreview(''); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const choose = value => { setFile(null); setAvatar(value); setError(''); };
  const chooseFile = selected => {
    if (!selected) return;
    if (selected.size > 5 * 1024 * 1024) return setError('群头像不能超过 5 MB');
    if (selected.type && !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(selected.type)) return setError('群头像请使用 JPG、PNG、GIF 或 WebP 图片');
    setError(''); setFile(selected);
  };
  async function save(event) {
    event.preventDefault();
    if (busy || (!file && avatar === (room.avatar || null))) return;
    setBusy(true); setError('');
    try {
      if (file) await upload(file, { purpose: 'room-avatar', roomId: room.id });
      else if (avatar) await api('room-avatar', { roomId: room.id, avatar });
      else await api('room-avatar/remove', { roomId: room.id });
      await onSaved(); onClose(); notify('群头像已更新');
    } catch (error) { setError(error.message); } finally { setBusy(false); }
  }
  return <Modal title="设置群头像" subtitle={room.name} onClose={() => { if (!busy) onClose(); }}><form className="room-avatar-form" onSubmit={save}>
    <fieldset disabled={busy}><div className="profile-avatar">
      {file && preview ? <span className="avatar avatar-photo" style={{ width: 88, height: 88 }}><img src={preview} alt="待保存的群头像" /></span> : avatar ? <Avatar user={{ avatar }} size={88} /> : <span className="room-avatar room-avatar-preview">{room.kind === 'public' ? <Hash size={36} /> : <Users size={36} />}</span>}
      <div className="room-avatar-actions"><button type="button" className="secondary-button" onClick={() => fileInput.current.click()}><Camera size={16} />上传图片</button>{(file || avatar) && <button type="button" className="text-button" onClick={() => choose(null)}>恢复默认</button>}</div><small>JPG、PNG、GIF、WebP · 最大 5 MB</small>
    </div><input ref={fileInput} type="file" aria-label="上传群头像" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={event => { chooseFile(event.target.files[0]); event.target.value = ''; }} /><AvatarPicker avatar={file ? null : avatar} setAvatar={choose} /></fieldset>
    {error && <p className="form-error" role="alert">{error}</p>}<div className="modal-footer"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>取消</button><button className="primary-button" disabled={busy || (!file && avatar === (room.avatar || null))}>{busy ? '正在保存…' : '保存头像'}</button></div>
  </form></Modal>;
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
      await onCreated(result.id || room.id); onClose(); notify(result.pending ? '已发送入群申请，等待群主或管理员同意' : room ? '成员已加入群聊' : '群聊已创建');
    } catch (error) { setError(error.message); } finally { setBusy(false); }
  }
  return <Modal title={room ? `邀请成员加入${room.name}` : '把大家聚在一起'} subtitle={room ? '新成员加入后可以查看群聊历史消息。' : '创建一个群聊，让话题有自己的小天地。'} onClose={onClose}><form onSubmit={submit}>
    {!room && <><label className="field-label" htmlFor="group-name">群聊名称</label><input id="group-name" placeholder="例如：午饭研究所" value={name} maxLength={24} onChange={event => setName(event.target.value)} required /></>}
    <div className="field-label group-select-label"><span>选择成员</span><small>已选 {selected.length} 人</small></div><div className="search-input"><Search size={16} /><input placeholder="搜索昵称" aria-label="搜索群成员" value={search} onChange={event => setSearch(event.target.value)} /></div>
    <div className="member-picker">{filtered.map(user => <label className="member-option" key={user.id}><input type="checkbox" checked={selected.includes(user.id)} onChange={event => setSelected(previous => event.target.checked ? [...previous, user.id] : previous.filter(id => id !== user.id))} /><Avatar user={user} size={36} online={user.online} /><span>{user.name}<small>{user.online ? '在线' : '离线'}</small></span><span className={`selection-check ${selected.includes(user.id) ? 'checked' : ''}`}>{selected.includes(user.id) && <Check size={13} />}</span></label>)}{!filtered.length && <div className="compact-empty"><Users size={25} /><p>{candidates.length ? '没有找到这个昵称' : room ? '空间里的成员都已在群中' : '还没有其他成员，先邀请同事加入空间吧'}</p></div>}</div>
    {error && <p className="form-error" role="alert">{error}</p>}<div className="modal-footer"><button className="secondary-button" type="button" onClick={onClose}>取消</button><button className="primary-button" disabled={busy || !selected.length}>{busy ? '处理中…' : room ? '邀请加入' : '创建群聊'}<ArrowRight size={16} /></button></div>
  </form></Modal>;
}

// 转发：选一个目标会话，逐条发送。
export function ForwardDialog({ count, rooms, icon, onClose, onForward }) {
  const [search, setSearch] = useState('');
  const [target, setTarget] = useState(null);
  const [merge, setMerge] = useState(false);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const filtered = rooms.filter(room => room.name.toLowerCase().includes(search.toLowerCase()));
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { await onForward(target, merge, comment.trim()); onClose(); } catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  return <Modal title={`转发 ${count} 条消息`} subtitle={merge ? '合成一条「聊天记录」发过去，点开可以看到每条消息。' : '选择一个会话，消息会逐条发送过去。'} onClose={onClose}><form onSubmit={submit}>
    {count > 1 && <div className="segmented-control forward-mode" role="radiogroup" aria-label="转发方式">{[[false, '逐条转发'], [true, '合并转发']].map(([value, label]) => <button type="button" key={label} role="radio" aria-checked={merge === value} className={merge === value ? 'active' : ''} onClick={() => setMerge(value)}>{label}</button>)}</div>}
    <div className="search-input"><Search size={16} /><input autoFocus placeholder="搜索会话" aria-label="搜索会话" value={search} onChange={event => setSearch(event.target.value)} /></div>
    <div className="member-picker" role="radiogroup" aria-label="转发到">{filtered.map(room => <label className="member-option" key={room.id}>
      <input type="radio" name="forward-target" checked={target?.id === room.id} onChange={() => setTarget(room)} />{icon(room)}<span>{room.name}</span>
      <span className={`selection-check ${target?.id === room.id ? 'checked' : ''}`}>{target?.id === room.id && <Check size={13} />}</span></label>)}
      {!filtered.length && <div className="compact-empty"><Search size={25} /><p>没有找到这个会话</p></div>}</div>
    {target && <input className="forward-comment" aria-label="附言" placeholder="附言（可选），会在转发的消息之后发出" maxLength={2000} value={comment} onChange={event => setComment(event.target.value)} />}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="modal-footer"><button className="secondary-button" type="button" onClick={onClose}>取消</button><button className="primary-button" disabled={busy || !target}>{busy ? '正在转发…' : target ? `转发到「${target.name}」` : '转发'}<ArrowRight size={16} /></button></div>
  </form></Modal>;
}

// 自定义状态：常用预设、表情和文字、到期自动清除。
const STATUS_PRESETS = [['📅', '开会中'], ['🏖', '休假中'], ['🏠', '远程办公'], ['🍱', '吃饭中'], ['🎯', '专注中，晚点回复'], ['🤒', '生病了']];
const STATUS_EXPIRY = [['none', '不清除'], ['30m', '30 分钟'], ['1h', '1 小时'], ['today', '今天'], ['week', '本周']];
const expiryTime = key => {
  const now = new Date();
  if (key === '30m') return now.getTime() + 30 * 60000;
  if (key === '1h') return now.getTime() + 3600000;
  if (key === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - 1;
  if (key === 'week') return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 8 - (now.getDay() || 7)).getTime() - 1;
  return null;
};
export function StatusDialog({ status, notify, onClose }) {
  const [emoji, setEmoji] = useState(status?.emoji || '');
  const [text, setText] = useState(status?.text || '');
  const [expiry, setExpiry] = useState(status?.until ? 'keep' : 'none');
  const [busy, setBusy] = useState(false);
  async function save(next) {
    setBusy(true);
    try {
      const until = next.expiry === 'keep' ? status.until : expiryTime(next.expiry);
      await api('status', { emoji: next.emoji.trim(), text: next.text.trim(), until });
      notify(next.emoji.trim() || next.text.trim() ? '状态已更新' : '状态已清除'); onClose();
    } catch (error) { notify(error.message); setBusy(false); }
  }
  return <Modal title="设置状态" subtitle="状态会显示在你的资料卡和名字旁边。" onClose={() => !busy && onClose()}>
    <form onSubmit={event => { event.preventDefault(); save({ emoji, text, expiry }); }}>
      <div className="status-presets">{STATUS_PRESETS.map(([icon, label]) => <button type="button" key={label} className={emoji === icon && text === label ? 'active' : ''} onClick={() => { setEmoji(icon); setText(label); }}><span>{icon}</span>{label}</button>)}</div>
      <div className="status-inputs"><input aria-label="状态表情" className="status-emoji-input" maxLength={8} placeholder="😀" value={emoji} onChange={event => setEmoji(event.target.value)} />
        <input aria-label="状态文字" maxLength={40} placeholder="在忙什么？" value={text} onChange={event => setText(event.target.value)} /></div>
      <label className="field-label" htmlFor="status-expiry">自动清除</label>
      <select id="status-expiry" value={expiry} onChange={event => setExpiry(event.target.value)}>
        {status?.until && <option value="keep">保持（{new Date(status.until).toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}）</option>}
        {STATUS_EXPIRY.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      <div className="modal-footer">{status && <button type="button" className="text-button danger-text folder-delete" disabled={busy} onClick={() => save({ emoji: '', text: '', expiry: 'none' })}>清除状态</button>}
        <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>取消</button><button className="primary-button" disabled={busy || (!emoji.trim() && !text.trim())}>保存</button></div>
    </form>
  </Modal>;
}

// 新建或编辑会话文件夹：名称 + 勾选会话；编辑时可以删除。
export function FolderDialog({ folder, rooms, icon, onSave, onDelete, onClose }) {
  const [name, setName] = useState(folder?.name || '');
  const [chosen, setChosen] = useState(() => new Set(folder?.roomIds || []));
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const shown = rooms.filter(room => room.name.toLowerCase().includes(search.trim().toLowerCase()));
  const toggle = id => setChosen(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  async function run(action) {
    setBusy(true); setError('');
    try { await action(); onClose(); } catch (failure) { setError(failure.message); setBusy(false); }
  }
  return <Modal title={folder ? '编辑文件夹' : '新建文件夹'} subtitle="在会话列表上方按文件夹查看会话，会同步到你的其他设备。" onClose={() => !busy && onClose()}>
    <form onSubmit={event => { event.preventDefault(); run(() => onSave(name.trim(), [...chosen])); }}>
      <label className="field-label" htmlFor="folder-name">名称</label>
      <input id="folder-name" autoFocus maxLength={12} required placeholder="例如：项目、家人" value={name} onChange={event => setName(event.target.value)} />
      <label className="field-label">会话 <small>已选 {chosen.size} 个</small></label>
      <div className="search-input"><Search size={16} /><input placeholder="搜索会话" aria-label="搜索会话" value={search} onChange={event => setSearch(event.target.value)} /></div>
      <div className="member-picker">{shown.map(room => <label className="member-option" key={room.id}>
        <input type="checkbox" checked={chosen.has(room.id)} onChange={() => toggle(room.id)} />{icon(room)}<span>{room.name}</span>
        <span className={`selection-check ${chosen.has(room.id) ? 'checked' : ''}`}>{chosen.has(room.id) && <Check size={13} />}</span></label>)}</div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-footer">{folder && <button type="button" className="text-button danger-text folder-delete" disabled={busy} onClick={() => run(onDelete)}>删除文件夹</button>}
        <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>取消</button><button className="primary-button" disabled={busy || !name.trim()}>{busy ? '正在保存…' : '保存'}</button></div>
    </form>
  </Modal>;
}

// 快捷键一览（⌘/ 打开）。Windows 上 ⌘ 显示为 Ctrl。
export function ShortcutsDialog({ sendKey, onClose }) {
  const mod = modKey, mac = modKey === '⌘', shift = mac ? '⇧' : 'Shift', alt = mac ? '⌥' : 'Alt';
  const groups = [
    ['通用', [[`${mod} K`, '快速切换会话'], [`${mod} 1–9`, '打开侧栏第 1–9 个会话'], [`${mod} ${shift} P`, '开关隐私模式'], [`${mod} /`, '打开快捷键一览'], ['Esc', '关闭弹窗、退出多选']]],
    ['输入', [[sendKey === 'enter' ? 'Enter' : `${mod} Enter`, '发送消息'], [sendKey === 'enter' ? `${shift} Enter` : 'Enter', '换行'], ['↑', '输入框为空时，编辑上一条消息'], ['Esc', '取消回复或编辑'], ['/', '插入格式（行首或空格后）'], ['@', '提及成员'], ['双击消息', '点 👍（可在设置里关闭）']]],
    ['格式', [[`${mod} B`, '粗体'], [`${mod} I`, '斜体'], [`${mod} E`, '行内代码'], [`${mod} ${shift} X`, '删除线'], [`${mod} K`, '把选中的文字做成链接']]],
    ['会话列表', [[`${alt} ↑ / ${alt} ↓`, '调整置顶会话的顺序'], [`${shift} F10`, '打开会话菜单']]],
    ['图片查看', [['← / →', '上一张 / 下一张'], ['+ / −', '放大 / 缩小'], ['0', '恢复原始大小'], ['Esc', '关闭']]],
  ];
  return <Modal title="键盘快捷键" onClose={onClose} className="shortcuts-dialog">
    <div className="shortcut-groups">{groups.map(([title, items]) => <section key={title}><h4>{title}</h4><dl>{items.map(([keys, label]) => <React.Fragment key={label}>
      {/* 「 / 」分开的是可以任选的按法，空格分开的是同时按的键 */}
      <dt>{keys.split(' / ').map((combo, index) => <React.Fragment key={index}>{index > 0 && <span className="key-or">/</span>}{combo.split(' ').map((key, keyIndex) => <kbd key={keyIndex}>{key}</kbd>)}</React.Fragment>)}</dt><dd>{label}</dd></React.Fragment>)}</dl></section>)}</div>
  </Modal>;
}

// 编辑历史：最新的在上面，每个版本带写下的时间。
export function EditHistoryDialog({ message, onClose }) {
  const [history, setHistory] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api(`message-history?id=${encodeURIComponent(message.id)}`).then(setHistory).catch(failure => setError(failure.message)); }, [message.id]);
  const when = time => new Date(time).toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const versions = history ? [{ ...history.current, current: true }, ...[...history.versions].reverse()] : [];
  return <Modal title="编辑历史" subtitle={history ? `共 ${versions.length} 个版本` : undefined} onClose={onClose}>
    {error ? <p className="form-error" role="alert">{error}</p> : !history ? <p className="inline-note">正在读取…</p> : <ol className="edit-history">
      {versions.map((version, index) => <li key={index} className={version.current ? 'current' : ''}>
        <small>{version.current ? '当前版本' : index === versions.length - 1 && history.complete ? '原始版本' : '较早版本'}{version.at ? ` · ${when(version.at)}` : ''}</small>
        <FormattedText text={version.text || '（无文字）'} /></li>)}
    </ol>}
    {history && !history.complete && <p className="inline-note">更早的版本在开始记录编辑历史之前，没有保存。</p>}
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

// 通用确认框：onConfirm 抛错时显示错误并允许重试。
export function ConfirmDialog({ title, subtitle, confirmLabel, busyLabel, danger = false, onConfirm, onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function confirm() {
    if (busy) return;
    setBusy(true); setError('');
    try { await onConfirm(); onClose(); } catch (failure) { setError(failure.message); setBusy(false); }
  }
  return <Modal title={title} subtitle={subtitle} onClose={() => !busy && onClose()}>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="modal-footer"><button className="secondary-button" disabled={busy} onClick={onClose}>取消</button><button className={`primary-button ${danger ? 'danger-button' : ''}`} disabled={busy} onClick={confirm}>{busy ? busyLabel : confirmLabel}</button></div>
  </Modal>;
}

// 群主修改群名或群公告；公告留空即撤下。
export function GroupEditDialog({ room, field, onClose, onSaved }) {
  const isName = field === 'name';
  const [value, setValue] = useState(isName ? room.name : room.announcement?.text || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { await api('room-settings', { roomId: room.id, [field]: value }); await onSaved(); onClose(); }
    catch (failure) { setError(failure.message); setBusy(false); }
  }
  return <Modal title={isName ? '修改群名' : '群公告'} subtitle={isName ? '群里的所有人都会看到新的群名。' : '公告会显示在群聊顶部，留空即撤下公告。'} onClose={() => !busy && onClose()}><form onSubmit={submit}>
    {isName ? <input autoFocus aria-label="群聊名称" value={value} maxLength={24} required onChange={event => setValue(event.target.value)} />
      : <><textarea autoFocus className="announcement-input" aria-label="群公告内容" value={value} maxLength={500} rows={5} onChange={event => setValue(event.target.value)} placeholder="例如：周五 18:00 发版，请提前合并代码" /><small className="field-hint">{value.trim().length}/500</small></>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="modal-footer"><button className="secondary-button" type="button" disabled={busy} onClick={onClose}>取消</button><button className="primary-button" disabled={busy || (isName && !value.trim())}>{busy ? '正在保存…' : '保存'}</button></div>
  </form></Modal>;
}

// 群机器人：创建或重置后只显示一次完整地址，外部系统向它 POST { "text": "..." } 即可发消息。
export function WebhooksDialog({ room, onClose, notify }) {
  const [hooks, setHooks] = useState(null);
  const [name, setName] = useState('');
  const [issued, setIssued] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = () => api(`webhooks?roomId=${encodeURIComponent(room.id)}`).then(result => setHooks(result.webhooks)).catch(failure => setError(failure.message));
  useEffect(() => { load(); }, [room.id]);
  async function run(action) {
    setBusy(true); setError('');
    try { await action(); await load(); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  const create = event => { event.preventDefault(); run(async () => { const result = await api('webhooks', { roomId: room.id, name }); setIssued({ name: result.webhook.name, url: absoluteUrl(result.path) }); setName(''); }); };
  const reset = hook => run(async () => { const result = await api('webhooks/reset', { id: hook.id }); setIssued({ name: hook.name, url: absoluteUrl(result.path) }); });
  const remove = hook => run(async () => { await api('webhooks/delete', { id: hook.id }); if (issued?.name === hook.name) setIssued(null); notify(`已删除机器人「${hook.name}」`); });
  async function copy() {
    try { await (window.desktop ? window.desktop.copy(issued.url) : copyText(issued.url)); notify('机器人地址已复制'); }
    catch { setError('复制失败，请选中上方地址复制'); }
  }
  return <Modal title="群机器人" subtitle={`外部系统可以通过机器人往「${room.name}」发消息，例如告警、构建结果、日报。`} onClose={() => !busy && onClose()}>
    {issued && <section className="webhook-issued" aria-live="polite"><b>「{issued.name}」的地址</b><input aria-label="机器人地址" value={issued.url} readOnly onFocus={event => event.target.select()} />
      <button type="button" className="primary-button full" onClick={copy}><Copy size={15} />复制地址</button>
      <p className="inline-note">地址里含有密钥，只显示这一次，请妥善保存；泄露后可以重置。用法：向地址 POST JSON <code>{'{"text":"内容"}'}</code>，每分钟最多 30 条。</p></section>}
    <ul className="webhook-list">{hooks?.map(hook => <li key={hook.id}><span className="webhook-icon"><Bot size={16} /></span><span className="webhook-name">{hook.name}</span>
      <button type="button" className="text-button" disabled={busy} onClick={() => reset(hook)}>重置地址</button><button type="button" className="text-button danger-text" disabled={busy} onClick={() => remove(hook)}>删除</button></li>)}</ul>
    {hooks && !hooks.length && <p className="inline-note">还没有机器人。</p>}
    <form className="webhook-create" onSubmit={create}><input aria-label="机器人名称" placeholder="机器人名称，例如：告警" value={name} maxLength={24} onChange={event => setName(event.target.value)} disabled={busy} />
      <button className="primary-button" disabled={busy || !name.trim()}>{busy ? '请稍候…' : '添加'}</button></form>
    {error && <p className="form-error" role="alert">{error}</p>}
  </Modal>;
}

const AUDIT_ACTIONS = { approve: '通过了注册', reject: '拒绝了注册', suspend: '停用了账号', role: '调整了角色', password: '修改了密码', 'reset-password': '重置了密码', 'delete-message': '删除了消息', mute: '禁言了', unmute: '解除了禁言', retention: '把消息保留期限改为' };
// 操作日志：谁在什么时候对谁做了哪项管理操作；被删消息只记会话，不保留内容。
export function AuditDialog({ onClose }) {
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api(`admin/audit?page=${page}`).then(setResult).catch(failure => setError(failure.message)); }, [page]);
  const where = entry => { if (entry.action !== 'delete-message') return ['role', 'mute'].includes(entry.action) ? `（${entry.detail}）` : ''; try { const detail = JSON.parse(entry.detail); return detail.roomName ? `（在「${detail.roomName}」）` : ''; } catch { return ''; } };
  return <Modal title="操作日志" subtitle="管理员的审核、权限、密码和删除消息操作，最新的在前。" wide onClose={onClose}>
    {error && <p className="form-error" role="alert">{error}</p>}
    {!result ? <p className="inline-note">正在加载…</p> : !result.entries.length ? <p className="inline-note">还没有管理操作。</p> : <ul className="audit-list">{result.entries.map(entry => <li key={entry.id}>
      <time>{new Date(entry.createdAt).toLocaleString('zh-CN', { hour12: false })}</time>
      <span><b>{entry.actor.name}</b> {AUDIT_ACTIONS[entry.action] || entry.action}{entry.action === 'retention' ? ` ${entry.detail}` : entry.action === 'password' ? '' : <> · <b>{entry.target.name}</b></>}{where(entry)}</span>
    </li>)}</ul>}
    {result?.total > 50 && <div className="account-pagination"><button className="secondary-button" disabled={page === 1} onClick={() => setPage(value => value - 1)}>上一页</button><span>第 {page} 页 · 共 {result.total} 条</span><button className="secondary-button" disabled={page * 50 >= result.total} onClick={() => setPage(value => value + 1)}>下一页</button></div>}
  </Modal>;
}

// 发起投票：问题加 2–10 个选项，可选多选。
export function PollDialog({ room, onClose, onCreated }) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [multiple, setMultiple] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const filled = options.map(option => option.trim()).filter(Boolean);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { const { message } = await api('polls', { roomId: room.id, question, options: filled, multiple }); onCreated(message); onClose(); }
    catch (failure) { setError(failure.message); setBusy(false); }
  }
  return <Modal title="发起投票" subtitle={`在「${room.name}」里发起，投票结果所有人可见。`} onClose={() => !busy && onClose()}><form onSubmit={submit} className="poll-form">
    <input autoFocus aria-label="投票问题" placeholder="问题，例如：中午吃什么？" value={question} maxLength={200} onChange={event => setQuestion(event.target.value)} />
    {options.map((option, index) => <div className="poll-form-option" key={index}><input aria-label={`选项 ${index + 1}`} placeholder={`选项 ${index + 1}`} value={option} maxLength={100}
      onChange={event => setOptions(previous => previous.map((item, position) => position === index ? event.target.value : item))} />
      {options.length > 2 && <button type="button" className="text-button" onClick={() => setOptions(previous => previous.filter((_, position) => position !== index))}>删除</button>}</div>)}
    {options.length < 10 && <button type="button" className="text-button" onClick={() => setOptions(previous => [...previous, ''])}>添加选项</button>}
    <label className="toggle-row"><input type="checkbox" checked={multiple} onChange={event => setMultiple(event.target.checked)} />允许多选</label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="modal-footer"><button className="secondary-button" type="button" disabled={busy} onClick={onClose}>取消</button><button className="primary-button" disabled={busy || !question.trim() || filled.length < 2}>{busy ? '正在发起…' : '发起投票'}</button></div>
  </form></Modal>;
}

// 常用时间：20 分钟后、1 小时后、今晚 20:00、明早 9:00，也可以自己选。
function TimeChoices({ value, onChange }) {
  const at = (days, hours, minutes = 0) => { const date = new Date(); date.setDate(date.getDate() + days); date.setHours(hours, minutes, 0, 0); return date.getTime(); };
  const choices = [['20 分钟后', Date.now() + 20 * 60000], ['1 小时后', Date.now() + 3600000],
    ...(new Date().getHours() < 19 ? [['今晚 20:00', at(0, 20)]] : []), ['明早 9:00', at(1, 9)]];
  const local = time => { const date = new Date(time - new Date(time).getTimezoneOffset() * 60000); return date.toISOString().slice(0, 16); };
  return <div className="time-choices">
    <div className="time-chips">{choices.map(([label, time]) => <button type="button" key={label} className={`secondary-button ${Math.abs(value - time) < 60000 ? 'selected' : ''}`} onClick={() => onChange(time)}>{label}</button>)}</div>
    <input type="datetime-local" aria-label="选择时间" value={value ? local(value) : ''} onChange={event => onChange(new Date(event.target.value).getTime())} />
  </div>;
}
const whenText = time => new Date(time).toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export function ScheduleDialog({ room, initialText = '', onClose, onScheduled }) {
  const [text, setText] = useState(initialText);
  const [time, setTime] = useState(Date.now() + 3600000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { await api('scheduled', { roomId: room.id, text, sendAt: time }); onScheduled(whenText(time)); onClose(); }
    catch (failure) { setError(failure.message); setBusy(false); }
  }
  return <Modal title="定时发送" subtitle={`到点后以你的名义发到「${room.name}」。`} onClose={() => !busy && onClose()}><form onSubmit={submit} className="poll-form">
    <textarea autoFocus className="announcement-input" aria-label="消息内容" rows={4} maxLength={10000} value={text} onChange={event => setText(event.target.value)} placeholder="要发送的内容" />
    <TimeChoices value={time} onChange={setTime} />
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="modal-footer"><button className="secondary-button" type="button" disabled={busy} onClick={onClose}>取消</button><button className="primary-button" disabled={busy || !text.trim()}>{busy ? '正在保存…' : `${whenText(time)} 发送`}</button></div>
  </form></Modal>;
}

export function ScheduledListDialog({ items, onCancel, onClose }) {
  return <Modal title="定时消息" subtitle="还没发出的消息，只有你自己看得到。" onClose={onClose}>
    <ul className="device-list">{items.map(item => <li key={item.id}><span><b>{whenText(item.sendAt)}</b><small className="scheduled-text">{item.text}</small></span>
      <button type="button" className="text-button danger-text" onClick={() => onCancel(item)}>取消发送</button></li>)}</ul>
  </Modal>;
}

export function ReminderDialog({ message, onClose, notify }) {
  const [time, setTime] = useState(Date.now() + 3600000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit() {
    setBusy(true); setError('');
    try { await api('reminders', { messageId: message.id, remindAt: time }); notify(`将在 ${whenText(time)} 提醒你`); onClose(); }
    catch (failure) { setError(failure.message); setBusy(false); }
  }
  return <Modal title="提醒我" subtitle="到时间会在这里和系统通知里提醒你，只有你自己收到。" onClose={() => !busy && onClose()}>
    <TimeChoices value={time} onChange={setTime} />
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="modal-footer"><button className="secondary-button" type="button" disabled={busy} onClick={onClose}>取消</button><button className="primary-button" disabled={busy} onClick={submit}>{busy ? '正在保存…' : '设置提醒'}</button></div>
  </Modal>;
}

// 禁言：选时长，或一直禁言到手动解除。
export function MuteDialog({ user, onClose, onDone }) {
  const [minutes, setMinutes] = useState(60);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit() {
    setBusy(true); setError('');
    try { await api('admin/mute', { userId: user.id, minutes }); onDone(); onClose(); }
    catch (failure) { setError(failure.message); setBusy(false); }
  }
  return <Modal title={`禁言「${user.name}」`} subtitle="禁言期间不能发消息、发投票或转发，可以随时解除。这次操作会记入操作日志。" onClose={() => !busy && onClose()}>
    <div className="time-chips">{[[10, '10 分钟'], [60, '1 小时'], [1440, '1 天'], [10080, '7 天'], [0, '直到解除']].map(([value, label]) =>
      <button type="button" key={value} className={`secondary-button ${minutes === value ? 'selected' : ''}`} onClick={() => setMinutes(value)}>{label}</button>)}</div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="modal-footer"><button className="secondary-button" type="button" disabled={busy} onClick={onClose}>取消</button><button className="primary-button danger-button" disabled={busy} onClick={submit}>{busy ? '正在禁言…' : '禁言'}</button></div>
  </Modal>;
}

// 合并转发的聊天记录：按原来的顺序列出每条消息，图片可以点开，文件可以下载。
export function BundleDialog({ message, privateMode, onPreview, onClose }) {
  const stamp = time => `${new Date(time).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })} ${formatTime(time)}`;
  return <Modal title={message.bundle.title} subtitle={`共 ${message.bundle.items.length} 条消息`} onClose={onClose} wide>
    <div className="bundle-list">{message.bundle.items.map((item, index) => <article key={index} className="bundle-item">
      <div className="thread-meta"><b>{item.senderName}</b><time>{stamp(item.createdAt)}</time></div>
      {item.text && (privateMode ? <p className="masked-preview">****</p> : <FormattedText text={item.text} />)}
      {item.attachments.length > 0 && !privateMode && <div className="bundle-files">{item.attachments.map(file => file.mime.startsWith('image/')
        ? <button type="button" key={file.id} className="bundle-image" onClick={() => onPreview(file)}><img src={mediaUrl(file.id)} alt={file.name} loading="lazy" /></button>
        : <a key={file.id} className="bundle-file" href={mediaUrl(file.id, true)} download={file.name}>{file.name}<small>{formatSize(file.size)}</small></a>)}</div>}
    </article>)}</div>
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
