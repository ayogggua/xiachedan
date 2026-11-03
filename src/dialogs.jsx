import React, { useRef, useState, useEffect } from 'react';
import { Camera, Check, Search, Users, ArrowRight, Wifi, ExternalLink, Bell, LoaderCircle, LogOut, KeyRound, Copy, Bot } from 'lucide-react';
import { api, upload, formatSize, absoluteUrl, mediaUrl, formatTime } from './api';
import { FormattedText } from './markdown';
import { Modal, Avatar, IdentityFields } from './components';
import { InvitationShare, JoinSpaceForm } from './Invitation';
import { THEMES } from './useTheme';
import { ACCENTS, FONT_SIZES } from './appearance';
import { readQuiet, saveQuiet, isQuiet } from './quiet';

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
    {invite ? cloud ? <div className="cloud-invite"><input aria-label="注册链接" value={invite.url || location.origin} readOnly onFocus={event => event.target.select()} /><button className="primary-button full" onClick={() => navigator.clipboard.writeText(invite.url || location.origin).then(() => notify('注册链接已复制')).catch(() => setError('复制失败，请选中上方链接复制'))}><Copy size={15} />复制注册链接</button></div> : <InvitationShare invite={invite} notify={notify} /> : !error && <p className="inline-note">正在获取邀请信息…</p>}
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

// 转发：选一个目标会话，逐条发送。
export function ForwardDialog({ count, rooms, icon, onClose, onForward }) {
  const [search, setSearch] = useState('');
  const [target, setTarget] = useState(null);
  const [merge, setMerge] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const filtered = rooms.filter(room => room.name.toLowerCase().includes(search.toLowerCase()));
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { await onForward(target, merge); onClose(); } catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  return <Modal title={`转发 ${count} 条消息`} subtitle={merge ? '合成一条「聊天记录」发过去，点开可以看到每条消息。' : '选择一个会话，消息会逐条发送过去。'} onClose={onClose}><form onSubmit={submit}>
    {count > 1 && <div className="segmented-control forward-mode" role="radiogroup" aria-label="转发方式">{[[false, '逐条转发'], [true, '合并转发']].map(([value, label]) => <button type="button" key={label} role="radio" aria-checked={merge === value} className={merge === value ? 'active' : ''} onClick={() => setMerge(value)}>{label}</button>)}</div>}
    <div className="search-input"><Search size={16} /><input autoFocus placeholder="搜索会话" aria-label="搜索会话" value={search} onChange={event => setSearch(event.target.value)} /></div>
    <div className="member-picker" role="radiogroup" aria-label="转发到">{filtered.map(room => <label className="member-option" key={room.id}>
      <input type="radio" name="forward-target" checked={target?.id === room.id} onChange={() => setTarget(room)} />{icon(room)}<span>{room.name}</span>
      <span className={`selection-check ${target?.id === room.id ? 'checked' : ''}`}>{target?.id === room.id && <Check size={13} />}</span></label>)}
      {!filtered.length && <div className="compact-empty"><Search size={25} /><p>没有找到这个会话</p></div>}</div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="modal-footer"><button className="secondary-button" type="button" onClick={onClose}>取消</button><button className="primary-button" disabled={busy || !target}>{busy ? '正在转发…' : target ? `转发到「${target.name}」` : '转发'}<ArrowRight size={16} /></button></div>
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
      notify(shown ? '已发送测试提醒；未弹出时请检查系统通知设置。' : '提醒未能发送，请检查系统通知设置。');
    } catch (error) { notify(error.message); }
  }
  if (!settings) return null;
  return <section className="desktop-settings" aria-label="菜单栏与提醒">
    <div className="notification-setting"><Bell size={18} /><span><b>新消息弹窗提醒</b><small>窗口关闭后，虾扯蛋仍会在菜单栏接收消息。</small></span><button type="button" role="switch" aria-label="新消息弹窗提醒" aria-checked={settings.notificationsEnabled} className={`switch ${settings.notificationsEnabled ? 'enabled' : ''}`} onClick={toggle}><i className="switch-track"><i /></i></button></div>
    <p className="inline-note">首次使用请允许通知。隐私模式下，通知内容也只显示 ****。</p>
    <div className="notification-actions"><button className="secondary-button" type="button" onClick={test} disabled={!settings.notificationsEnabled || !settings.notificationSupported}>测试提醒</button><button className="text-button" type="button" onClick={() => window.desktop.notificationSettings().catch(error => notify(error.message))}>{window.desktop.platform === 'windows' ? '系统通知设置' : 'macOS 通知设置'}<ExternalLink size={13} /></button></div>
    {settings.notificationError && <p className="form-error" role="alert">{settings.notificationError}</p>}
  </section>;
}

function UpdateSettings({ update, onUpdate, notify }) {
  const [busy, setBusy] = useState('');
  const [percent, setPercent] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => window.desktop.onEvent(event => { if (event.type === 'update-progress') setPercent(event.percent); }), []);
  async function check() {
    setBusy('check'); setError('');
    try { const info = await window.desktop.updates.check(); onUpdate(info); if (info.enabled && !info.available) notify('已是最新版本'); }
    catch (failure) { setError(failure.message); } finally { setBusy(''); }
  }
  async function install() {
    setBusy('install'); setError(''); setPercent(0);
    try { await window.desktop.updates.install(); }
    catch (failure) { setError(failure.message); setBusy(''); setPercent(null); }
  }
  const status = !update ? '正在检查更新…' : !update.enabled ? '此版本未开启自动更新' : update.available ? `发现新版本 v${update.version}` : '已是最新版本';
  return <section className="update-settings" aria-label="软件更新"><h3>软件更新</h3>
    <div className="update-row"><span><b>{update ? `当前版本 v${update.current}` : '虾扯蛋'}</b><small className={update?.available ? 'update-available' : ''}>{status}</small></span>
      {update?.available
        ? <button type="button" className="primary-button" disabled={Boolean(busy)} onClick={install}>{busy === 'install' ? <><LoaderCircle className="spin" size={14} />{percent === null ? '准备中' : `${percent}%`}</> : '立即更新'}</button>
        : <button type="button" className="secondary-button" disabled={Boolean(busy) || update?.enabled === false} onClick={check}>{busy === 'check' ? '检查中…' : '检查更新'}</button>}
    </div>
    {busy === 'install' && <div className="update-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? 0}><i style={{ transform: `scaleX(${(percent ?? 0) / 100})` }} /></div>}
    {update?.available && update.notes && <div className="update-notes"><FormattedText text={releaseNotes(update.notes)} /></div>}
    {busy === 'install' && <p className="inline-note">下载完成后会自动安装并重新启动虾扯蛋。</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>;
}

// 更新说明来自 GitHub Release 正文：标题转成粗体，PR 链接缩成 #编号，其余交给聊天里的格式渲染。
const releaseNotes = notes => notes.replace(/\r\n?/g, '\n')
  .replace(/^#{1,6}\s+(.+)$/gm, (_, title) => `**${title.trim() === "What's Changed" ? '更新内容' : title.trim()}**`)
  .replace(/^\*\*Full Changelog\*\*:\s*(\S+)$/gm, '[查看完整更新记录]($1)')
  .replace(/\bin (https:\/\/github\.com\/[^\s/]+\/[^\s/]+\/pull\/(\d+))/g, '[#$2]($1)')
  .replace(/\n\s*\n+/g, '\n').trim();

export function ConnectionDialog({ theme, onTheme, update, onUpdate, connected, me, workspace, onPassword, onLogout, loggingOut, onCleared, onClose, notify, onAudit, onChanged, appearance, onAppearance }) {
  const cloud = workspace.mode === 'cloud';
  return <Modal title="设置" subtitle={cloud ? undefined : '所有聊天都通过局域网连接。'} onClose={onClose}>
    <section className="appearance-settings"><h3>外观</h3><div className="segmented-control three" role="radiogroup" aria-label="外观">{THEMES.map(([key, label]) => <button type="button" key={key} role="radio" aria-checked={theme === key} className={theme === key ? 'active' : ''} onClick={() => onTheme(key)}>{label}</button>)}</div>
      {appearance && <>
        <div className="accent-row" role="radiogroup" aria-label="主题色">{ACCENTS.map(([label, value]) => <button type="button" key={label} role="radio" aria-checked={appearance.accent === value} aria-label={`${label}色`} title={`${label}色`}
          className={`accent-swatch ${appearance.accent === value ? 'active' : ''}`} style={{ background: value || '#d9653f' }} onClick={() => onAppearance({ ...appearance, accent: value })} />)}
          <label className={`accent-swatch custom ${appearance.accent && !ACCENTS.some(([, value]) => value === appearance.accent) ? 'active' : ''}`} title="自定义颜色" style={{ background: appearance.accent && !ACCENTS.some(([, value]) => value === appearance.accent) ? appearance.accent : undefined }}>
            <input type="color" aria-label="自定义主题色" value={appearance.accent || '#d9653f'} onChange={event => onAppearance({ ...appearance, accent: event.target.value })} /></label></div>
        <div className="segmented-control font-size-control" role="radiogroup" aria-label="消息字号">{FONT_SIZES.map(([label, size]) => <button type="button" key={size} role="radio" aria-checked={appearance.fontSize === size} className={appearance.fontSize === size ? 'active' : ''} onClick={() => onAppearance({ ...appearance, fontSize: size })}>{label}</button>)}</div>
      </>}
    </section>
    <div className="connection-card"><Wifi size={22} /><div><b>{connected ? '已连接到聊天空间' : '正在尝试重新连接'}</b><span>{location.origin}</span></div><i className={connected ? 'online' : ''} /></div>
    {!cloud && <p className="inline-note">消息和附件保存在创建空间的电脑上。隐私模式用于遮挡屏幕内容；局域网传输使用 HTTP，请在可信网络内使用。</p>}
    <section className="account-settings"><h3>账号</h3><p>{cloud ? me.phone || me.email : me.name}</p><div className="account-actions">{cloud && <button className="secondary-button" onClick={onPassword}><KeyRound size={15} />修改密码</button>}<button className="secondary-button" disabled={loggingOut} onClick={onLogout}><LogOut size={15} />{loggingOut ? '正在退出…' : '退出登录'}</button></div></section>
    <QuietSettings notify={notify} />
    {cloud && <DeviceSettings notify={notify} />}
    {onAudit && <section className="device-settings"><h3>管理</h3><button type="button" className="secondary-button" onClick={onAudit}>查看操作日志</button>
      <label className="toggle-row retention-row">消息保留期限<select aria-label="消息保留期限" value={workspace.retentionDays || 0} onChange={async event => { try { await api('admin/retention', { days: Number(event.target.value) }); await onChanged?.(); notify('保留期限已更新'); } catch (error) { notify(error.message); } }}>{[[0, '永久保留'], [30, '30 天'], [90, '90 天'], [180, '180 天'], [365, '1 年']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {workspace.retentionDays > 0 && <p className="inline-note">超过 {workspace.retentionDays} 天的消息和附件会被自动删除，无法恢复。</p>}</section>}
    {workspace.ownerId === me.id && <StorageSettings cloud={cloud} onCleared={onCleared} notify={notify} />}
    {window.desktop?.updates && <UpdateSettings update={update} onUpdate={onUpdate} notify={notify} />}
    {window.desktop && <>{window.desktop.getState && <DesktopSettings notify={notify} />}
      {!cloud && <><h3 className="join-space-heading">加入另一个空间</h3><JoinSpaceForm identity={me} />
      <button type="button" className="text-button back-link" onClick={() => window.desktop.home().catch(error => notify(error.message))}>返回本机空间</button></>}
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
    try { await (window.desktop ? window.desktop.copy(issued.url) : navigator.clipboard.writeText(issued.url)); notify('机器人地址已复制'); }
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
        : <a key={file.id} className="bundle-file" href={mediaUrl(file.id, true)} download>{file.name}<small>{formatSize(file.size)}</small></a>)}</div>}
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

// 勿扰：每天的固定时段，或临时暂停一阵子；只影响这台设备的系统通知，消息照常收到、未读照常计数。
function QuietSettings({ notify }) {
  const [quiet, setQuiet] = useState(readQuiet);
  const change = next => { const value = { ...quiet, ...next }; setQuiet(value); saveQuiet(value); };
  const pause = hours => { const until = hours ? Date.now() + hours * 3600000 : (() => { const date = new Date(); date.setHours(24, 0, 0, 0); return date.getTime(); })(); change({ until }); notify(`通知已暂停到 ${new Date(until).toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`); };
  const paused = quiet.until > Date.now();
  return <section className="device-settings quiet-settings"><h3>勿扰</h3>
    <label className="toggle-row"><input type="checkbox" checked={quiet.enabled} onChange={event => change({ enabled: event.target.checked })} />每天
      <input type="time" aria-label="开始时间" value={quiet.start} disabled={!quiet.enabled} onChange={event => change({ start: event.target.value })} />到
      <input type="time" aria-label="结束时间" value={quiet.end} disabled={!quiet.enabled} onChange={event => change({ end: event.target.value })} />不弹通知</label>
    <label className="toggle-row"><input type="checkbox" checked={quiet.mentions} onChange={event => change({ mentions: event.target.checked })} />有人 @我 时照常提醒</label>
    <div className="time-chips">{paused ? <><span className="inline-note">已暂停到 {new Date(quiet.until).toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span><button type="button" className="secondary-button" onClick={() => change({ until: 0 })}>恢复通知</button></>
      : <><button type="button" className="secondary-button" onClick={() => pause(1)}>暂停 1 小时</button><button type="button" className="secondary-button" onClick={() => pause(0)}>今天不再提醒</button></>}</div>
    {isQuiet() && <p className="inline-note">现在处于勿扰中：消息照常收到，只是不弹系统通知。</p>}
  </section>;
}

// 从浏览器标识里认出系统和应用，够用就好。
function deviceName(agent) {
  const system = /iPhone|iPad/.test(agent) ? 'iOS' : /Android/.test(agent) ? 'Android' : /Mac OS X|Macintosh/.test(agent) ? 'macOS' : /Windows/.test(agent) ? 'Windows' : /Linux/.test(agent) ? 'Linux' : '未知系统';
  const app = /Edg\//.test(agent) ? 'Edge' : /Firefox\//.test(agent) ? 'Firefox' : /Chrome\//.test(agent) ? 'Chrome' : /Version\/[\d.]+.*Safari\//.test(agent) ? 'Safari' : /AppleWebKit|WebView2/.test(agent) ? '桌面客户端' : '浏览器';
  return `${system} · ${app}`;
}

function DeviceSettings({ notify }) {
  const [sessions, setSessions] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = () => api('sessions').then(result => setSessions(result.sessions)).catch(failure => setError(failure.message));
  useEffect(() => { load(); }, []);
  async function revoke(body, message) {
    setBusy(true); setError('');
    try { await api('sessions/revoke', body); notify(message); await load(); }
    catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  const when = time => new Date(time).toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return <section className="device-settings"><h3>登录设备</h3>
    {!sessions ? <p className="inline-note">正在读取登录设备…</p> : <ul className="device-list">{sessions.map(item => <li key={item.id}>
      <span><b>{deviceName(item.userAgent)}{item.current && <small className="me-tag">当前</small>}</b><small>{item.ip || '未知地址'} · 最近活跃 {when(item.lastSeen)}</small></span>
      {!item.current && <button type="button" className="text-button danger-text" disabled={busy} onClick={() => revoke({ id: item.id }, '该设备已下线')}>下线</button>}
    </li>)}</ul>}
    {sessions?.length > 1 && <button type="button" className="secondary-button" disabled={busy} onClick={() => revoke({ others: true }, '其他设备已全部下线')}>退出其他所有设备</button>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>;
}

function StorageSettings({ cloud, onCleared, notify }) {
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
    <p className="inline-note">清空整个空间所有会话的聊天记录及已发送的图片、视频，释放{cloud ? '服务器' : '创建空间的电脑'}上的存储。成员、头像和群聊会保留。</p>
    <button className="secondary-button storage-clear-button" disabled={!info || busy} onClick={() => setConfirming(true)}>清空空间聊天记录</button>
    {error && <p className="form-error" role="alert">{error}</p>}
    {confirming && <Modal title="清空整个空间的聊天记录？" subtitle="所有成员的大厅、群聊和私聊记录都会删除，图片与视频文件也会删除。此操作无法恢复。" onClose={() => !busy && setConfirming(false)}>
      <label className="field-label" htmlFor="clear-history-confirm">输入“清空”以确认</label><input id="clear-history-confirm" value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy} autoComplete="off" />
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-footer"><button className="secondary-button" disabled={busy} onClick={() => setConfirming(false)}>取消</button><button className="primary-button danger-button" disabled={busy || confirmation !== '清空'} onClick={clear}>{busy ? '正在清理…' : '确认清空'}</button></div>
    </Modal>}
  </section>;
}
