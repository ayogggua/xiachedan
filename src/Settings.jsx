import React, { useEffect, useState } from 'react';
import { Bell, ChevronLeft, ChevronRight, ExternalLink, Info, KeyRound, X, LoaderCircle, LogOut, MessageSquare, Palette, PencilLine, Server, ShieldCheck, UserRound, Wifi } from 'lucide-react';
import { api, absoluteUrl, formatSize } from './api';
import { mobileClient } from './mobile/session';
import { FormattedText } from './markdown';
import { Avatar, Modal, activeStatus } from './components';
import { JoinSpaceForm } from './Invitation';
import { THEMES } from './useTheme';
import { ACCENTS, FONT_SIZES, WALLPAPERS, wallpaperCss, readWallpaperImage, saveWallpaperImage } from './appearance';
import { SKINS } from './skin';
import { readQuiet, saveQuiet, isQuiet } from './quiet';
import { modKey } from './chatPrefs';
import { playMessageSound } from './sound';
import { disablePush, enablePush, needsHomeScreen, pushState, pushSupported } from './push';
import { appLockSupported, LOCK_TIMEOUTS } from './AppLock';

// 设置：左侧分类，右侧内容；窄屏时先选分类再进入内容页。
const SECTIONS = [
  ['account', '账号', UserRound], ['appearance', '外观', Palette], ['chat', '聊天', MessageSquare], ['notifications', '通知', Bell],
  ['privacy', '隐私与安全', ShieldCheck], ['space', '空间', Server], ['about', '关于', Info],
];

function Switch({ label, checked, onChange, disabled = false }) {
  return <button type="button" role="switch" aria-label={label} aria-checked={checked} disabled={disabled} className={`switch ${checked ? 'enabled' : ''}`} onClick={() => onChange(!checked)}><i className="switch-track"><i /></i></button>;
}
function SettingRow({ title, description, children }) {
  return <div className="setting-row"><span><b>{title}</b>{description && <small>{description}</small>}</span>{children}</div>;
}

// 手机推送：只在能用的环境里显示；iPhone 上提示先添加到主屏幕。
function PushSettings({ settings, notify }) {
  const [enabled, setEnabled] = useState(() => pushSupported() && Boolean(pushState()) && Notification.permission === 'granted');
  const [busy, setBusy] = useState(false);
  if (needsHomeScreen()) return <SettingRow title="手机推送" description="在 Safari 里点「分享 → 添加到主屏幕」，从主屏幕打开虾扯蛋后就能开启。" />;
  if (!pushSupported()) return null;
  const change = async value => {
    setBusy(true);
    try {
      if (value) { await enablePush(settings); notify('已开启手机推送'); } else { await disablePush(); notify('已关闭手机推送'); }
      setEnabled(value);
      window.dispatchEvent(new Event('linliao:resume'));
    } catch (error) { notify(error.message); } finally { setBusy(false); }
  };
  return <SettingRow title="手机推送" description={Notification.permission === 'denied' ? '通知权限被拒绝，请在系统设置里允许虾扯蛋发送通知。' : '虾扯蛋在后台或没有打开时，也会收到新消息通知。免打扰的会话只在被 @ 时推送。'}>
    <Switch label="手机推送" checked={enabled} disabled={busy} onChange={change} /></SettingRow>;
}

export function SettingsDialog({ appLock, phrases, onPhrases, pushSettings, theme, onTheme, update, onUpdate, connected, me, workspace, onPassword, onEditProfile, onLogout, loggingOut, onCleared, onClose, notify, onAudit, onChanged, appearance, onAppearance, skin, onSkin, privateMode, onPrivateMode, chatPrefs, onChatPrefs, onShortcuts, keywords, onKeywords, onSetStatus }) {
  const cloud = workspace.mode === 'cloud';
  const [tab, setTab] = useState(() => SECTIONS.some(([id]) => id === sessionStorage.getItem('linliao.settingsTab')) ? sessionStorage.getItem('linliao.settingsTab') : 'account');
  const [paneOpen, setPaneOpen] = useState(false);
  const open = id => { setTab(id); setPaneOpen(true); sessionStorage.setItem('linliao.settingsTab', id); };
  const panes = {
    account: <>
      <div className="settings-profile"><Avatar user={me} size={52} /><span><b>{me.name}</b><small>{cloud ? me.phone || me.email : '局域网成员'}</small></span></div>
      {onSetStatus && <SettingRow title="状态" description={activeStatus(me) ? `${activeStatus(me).emoji} ${activeStatus(me).text}` : '让同事知道你在忙什么，比如开会、休假。'}><button type="button" className="secondary-button" onClick={onSetStatus}>{activeStatus(me) ? '修改' : '设置'}</button></SettingRow>}
      <div className="account-actions">
        <button type="button" className="secondary-button" onClick={onEditProfile}><PencilLine size={15} />编辑资料</button>
        {cloud && <button type="button" className="secondary-button" onClick={onPassword}><KeyRound size={15} />修改密码</button>}
        <button type="button" className="secondary-button" disabled={loggingOut} onClick={onLogout}><LogOut size={15} />{loggingOut ? '正在退出…' : '退出登录'}</button>
      </div>
    </>,
    appearance: <>
      {onSkin && <><h4>界面风格</h4><div className="segmented-control three" role="radiogroup" aria-label="界面风格">{SKINS.map(([key, label]) => <button type="button" key={key} role="radio" aria-checked={skin === key} className={skin === key ? 'active' : ''} onClick={() => onSkin(key)}>{label}</button>)}</div>
        <p className="inline-note">「经典」是熟悉的微信式三栏布局，「QQ」采用蓝色选中态和蓝色消息气泡。主题色和聊天背景每种风格各记一份，深浅色和字号共用。</p></>}
      <h4>外观模式</h4><div className="segmented-control three" role="radiogroup" aria-label="外观">{THEMES.map(([key, label]) => <button type="button" key={key} role="radio" aria-checked={theme === key} className={theme === key ? 'active' : ''} onClick={() => onTheme(key)}>{label}</button>)}</div>
      {appearance && <><h4>聊天背景</h4><WallpaperPicker appearance={appearance} onAppearance={onAppearance} theme={theme} notify={notify} /><h4>主题色</h4><div className="accent-row" role="radiogroup" aria-label="主题色">{ACCENTS.map(([label, value]) => <button type="button" key={label} role="radio" aria-checked={appearance.accent === value} aria-label={`${label}色`} title={`${label}色`}
          className={`accent-swatch ${appearance.accent === value ? 'active' : ''}`} style={{ background: value || '#d9653f' }} onClick={() => onAppearance({ ...appearance, accent: value })} />)}
          <label className={`accent-swatch custom ${appearance.accent && !ACCENTS.some(([, value]) => value === appearance.accent) ? 'active' : ''}`} title="自定义颜色" style={{ background: appearance.accent && !ACCENTS.some(([, value]) => value === appearance.accent) ? appearance.accent : undefined }}>
            <input type="color" aria-label="自定义主题色" value={appearance.accent || '#d9653f'} onChange={event => onAppearance({ ...appearance, accent: event.target.value })} /></label></div><h4>消息字号</h4><div className="segmented-control font-size-control" role="radiogroup" aria-label="消息字号">{FONT_SIZES.map(([label, size]) => <button type="button" key={size} role="radio" aria-checked={appearance.fontSize === size} className={appearance.fontSize === size ? 'active' : ''} onClick={() => onAppearance({ ...appearance, fontSize: size })}>{label}</button>)}</div></>}
    </>,
    chat: chatPrefs && <>
      <h4>头像</h4>
      {skin !== 'xiachedan' ? <p className="inline-note">经典和 QQ 风格下每条消息都显示双方的头像，名字只在群聊里显示别人的。</p> : <>
      <div className="segmented-control" role="radiogroup" aria-label="头像位置">{[['sticky', '跟随滚动'], ['top', '固定在第一条旁边']].map(([value, label]) =>
        <button type="button" key={value} role="radio" aria-checked={chatPrefs.avatarMode === value} className={chatPrefs.avatarMode === value ? 'active' : ''} onClick={() => onChatPrefs({ avatarMode: value })}>{label}</button>)}</div>
      <p className="inline-note">{chatPrefs.avatarMode === 'top' ? '头像对齐一组连续消息的第一条，不随滚动移动。' : '一组连续消息很长时，头像贴着可视区底部跟随滚动（Telegram 式）。'}</p>
      <SettingRow title="群聊中显示自己的头像"><Switch label="群聊中显示自己的头像" checked={chatPrefs.showSelfInGroups} onChange={value => onChatPrefs({ showSelfInGroups: value })} /></SettingRow>
      <SettingRow title="群聊中显示自己的名字"><Switch label="群聊中显示自己的名字" checked={chatPrefs.showSelfNameInGroups} onChange={value => onChatPrefs({ showSelfNameInGroups: value })} /></SettingRow>
      <SettingRow title="私聊中显示双方的头像和名字"><Switch label="私聊中显示双方的头像和名字" checked={chatPrefs.showBothInDirect} onChange={value => onChatPrefs({ showBothInDirect: value })} /></SettingRow>
      </>}
      <SettingRow title="双击消息点 👍" description="关闭后，双击消息里的文字可以选中词语。"><Switch label="双击消息点赞" checked={chatPrefs.quickReact} onChange={value => onChatPrefs({ quickReact: value })} /></SettingRow>
      {/* 触屏设备上回车总是换行，用发送按钮发送，不需要这一项。 */}
      {!matchMedia('(pointer: coarse)').matches && <>
      <h4>发送消息</h4>
      <div className="segmented-control" role="radiogroup" aria-label="发送键">{[['enter', 'Enter 发送'], ['mod-enter', `${modKey} Enter 发送`]].map(([value, label]) =>
        <button type="button" key={value} role="radio" aria-checked={chatPrefs.sendKey === value} className={chatPrefs.sendKey === value ? 'active' : ''} onClick={() => onChatPrefs({ sendKey: value })}>{label}</button>)}</div>
      <p className="inline-note">{chatPrefs.sendKey === 'enter' ? 'Shift + Enter 换行；在 ``` 代码块里回车也是换行。' : `Enter 换行，${modKey} + Enter 发送，适合经常写长消息。`}</p>
      </>}
      {onPhrases && <PhraseSettings phrases={phrases} onChange={onPhrases} notify={notify} />}
    </>,
    notifications: <>
      {window.desktop?.getState && <DesktopSettings notify={notify} />}
      {pushSettings && <PushSettings settings={pushSettings} notify={notify} />}
      {chatPrefs && <SettingRow title="新消息提示音" description="正在看的会话、免打扰会话和勿扰时段内不响。">
        <button type="button" className="text-button" onClick={() => playMessageSound({ force: true })}>试听</button>
        <Switch label="新消息提示音" checked={chatPrefs.sound} onChange={value => onChatPrefs({ sound: value })} /></SettingRow>}
      {(window.desktop || (!mobileClient && import.meta.env.MODE !== 'pwa')) && <QuietSettings notify={notify} />}
      {onKeywords && <KeywordSettings keywords={keywords} onChange={onKeywords} notify={notify} />}
    </>,
    privacy: <>
      <SettingRow title="隐私模式" description="隐藏聊天内容，鼠标停留在消息上才显示并计为已读；也可以按 ⌘⇧P 切换。"><Switch label="隐私模式" checked={privateMode} onChange={onPrivateMode} /></SettingRow>
      {appLock && <AppLockSettings appLock={appLock} notify={notify} onClose={onClose} />}
      {cloud && <DeviceSettings notify={notify} />}
    </>,
    space: <>
      <div className="connection-card"><Wifi size={22} /><div><b>{connected ? '已连接到聊天空间' : '正在尝试重新连接'}</b><span>{absoluteUrl('')}</span></div><i className={connected ? 'online' : ''} /></div>
      {!cloud && <p className="inline-note">所有聊天都通过局域网连接，消息和附件保存在创建空间的电脑上。局域网传输使用 HTTP，请在可信网络内使用。</p>}
      {onAudit && <section><h4>管理</h4><button type="button" className="secondary-button" onClick={onAudit}>查看操作日志</button>
      <label className="toggle-row retention-row">消息保留期限<select aria-label="消息保留期限" value={workspace.retentionDays || 0} onChange={async event => { try { await api('admin/retention', { days: Number(event.target.value) }); await onChanged?.(); notify('保留期限已更新'); } catch (error) { notify(error.message); } }}>{[[0, '永久保留'], [30, '30 天'], [90, '90 天'], [180, '180 天'], [365, '1 年']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {workspace.retentionDays > 0 && <p className="inline-note">超过 {workspace.retentionDays} 天的消息和附件会被自动删除，无法恢复。</p>}
      <label className="toggle-row retention-row">消息撤回时限<select aria-label="消息撤回时限" value={workspace.recallWindow || 0} onChange={async event => { try { await api('admin/recall-window', { seconds: Number(event.target.value) }); await onChanged?.(); notify('撤回时限已更新'); } catch (error) { notify(error.message); } }}>{[[0, '不限'], [120, '2 分钟'], [86400, '24 小时']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></section>}
      {workspace.ownerId === me.id && <StorageSettings cloud={cloud} onCleared={onCleared} notify={notify} />}
      {window.desktop && !cloud && <><h4>加入另一个空间</h4><JoinSpaceForm identity={me} />
        <button type="button" className="text-button back-link" onClick={() => window.desktop.home().catch(error => notify(error.message))}>返回本机空间</button></>}
    </>,
    about: <>
      {window.desktop?.updates ? <UpdateSettings update={update} onUpdate={onUpdate} notify={notify} />
        : <p className="inline-note">网页版随空间服务器一起更新，刷新页面即可使用最新版本。</p>}
      {onShortcuts && !matchMedia('(pointer: coarse)').matches && <SettingRow title="键盘快捷键" description={`随时按 ${modKey} / 查看。`}><button type="button" className="secondary-button" onClick={onShortcuts}>查看</button></SettingRow>}
    </>,
  };
  const current = SECTIONS.find(([id]) => id === tab) || SECTIONS[0];
  return <Modal title="设置" wide className="settings-dialog" onClose={onClose}>
    <div className={`settings-layout ${paneOpen ? 'pane-open' : ''}`}>
      <nav className="settings-nav" aria-label="设置分类">{SECTIONS.map(([id, label, Icon]) => <button type="button" key={id} aria-current={id === current[0] ? 'page' : undefined} onClick={() => open(id)}>
        <Icon size={16} /><span>{label}</span><ChevronRight className="settings-nav-arrow" size={14} /></button>)}</nav>
      <section className="settings-pane" aria-label={current[1]}>
        <button type="button" className="text-button settings-back" onClick={() => setPaneOpen(false)}><ChevronLeft size={15} />设置</button>
        <h3>{current[1]}</h3>{panes[current[0]]}
      </section>
    </div>
  </Modal>;
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
  return <section className="update-settings" aria-label="软件更新"><h4>软件更新</h4>
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

// 更新说明来自 GitHub 自动生成的 Release 正文：只留给用户看的内容。
// 「What's Changed」改成「更新内容」，去掉每条后面的「by @作者 in 链接」和整段「New Contributors」，完整记录收成一个链接。
const releaseNotes = notes => {
  const lines = [];
  let skipping = false;
  for (const raw of notes.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) { skipping = /new contributors/i.test(heading[1]); if (!skipping) lines.push(`**${/what's changed/i.test(heading[1]) ? '更新内容' : heading[1]}**`); continue; }
    const changelog = line.match(/^\*\*Full Changelog\*\*:\s*(\S+)$/);
    if (changelog) { skipping = false; lines.push('', `[查看完整更新记录](${changelog[1]})`); continue; }
    if (skipping || !line) continue;
    lines.push(line.replace(/\s+by @[\w-]+(?:\[bot\])?\s+in\s+https:\/\/github\.com\/\S+\/pull\/\d+\s*$/, ''));
  }
  return lines.join('\n');
};

// 聊天背景：预览块用当前深浅主题的样子；自定义图片只存在本机。
function WallpaperPicker({ appearance, onAppearance, theme, notify }) {
  const light = document.documentElement.dataset.theme === 'light';
  const [image, setImage] = useState(readWallpaperImage);
  async function upload(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    try { setImage(await saveWallpaperImage(file)); onAppearance({ ...appearance, wallpaper: 'custom' }); }
    catch { notify('图片太大或格式不支持，换一张试试'); }
  }
  return <div className="wallpaper-grid" role="radiogroup" aria-label="聊天背景" data-theme-key={theme}>
    {WALLPAPERS.map(([id, label]) => <button type="button" key={id} role="radio" aria-checked={appearance.wallpaper === id} className={`wallpaper-swatch ${appearance.wallpaper === id ? 'active' : ''}`}
      style={{ background: wallpaperCss(id, light) || undefined }} onClick={() => onAppearance({ ...appearance, wallpaper: id })}><span>{label}</span></button>)}
    <label className={`wallpaper-swatch custom ${appearance.wallpaper === 'custom' ? 'active' : ''}`} style={{ background: image ? wallpaperCss('custom', light, image) : undefined }}>
      <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={upload} /><span>{image ? '我的图片' : '上传图片'}</span></label>
    {image && appearance.wallpaper !== 'custom' && <button type="button" className="text-button" onClick={() => onAppearance({ ...appearance, wallpaper: 'custom' })}>使用我的图片</button>}
  </div>;
}

// 关键词提醒：消息里出现这些词时像被 @ 一样提醒（免打扰的会话也会提醒），在所有设备上生效。
// 应用锁：设置本机密码和闲置多久后锁定；关闭时要先输入密码。
function AppLockSettings({ appLock, notify, onClose }) {
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!appLockSupported()) return <SettingRow title="应用锁" description="需要在桌面端或 HTTPS 网页里使用，局域网的 http 地址上不可用。" />;
  async function submit(event) {
    event.preventDefault(); setError('');
    if (form.mode === 'enable') {
      if (form.password.length < 4) return setError('密码至少 4 位');
      if (form.password !== form.confirm) return setError('两次输入的密码不一样');
      setBusy(true); await appLock.enable(form.password, form.minutes); setBusy(false);
      notify('已开启应用锁'); setForm(null);
    } else {
      setBusy(true); const ok = await appLock.verify(form.password); setBusy(false);
      if (!ok) return setError('密码不对');
      appLock.disable(); notify('已关闭应用锁'); setForm(null);
    }
  }
  return <section className="app-lock-settings">
    <SettingRow title="应用锁" description={appLock.enabled ? `闲置或切到后台超过 ${LOCK_TIMEOUTS.find(([value]) => value === appLock.minutes)?.[1] || `${appLock.minutes} 分钟`} 后锁定，打开时也要先解锁。` : '离开一会儿，别人也看不到聊天。密码只存在这台设备上，不加密本机数据。'}>
      <Switch label="应用锁" checked={appLock.enabled} onChange={value => { setError(''); setForm(value ? { mode: 'enable', password: '', confirm: '', minutes: 5 } : { mode: 'disable', password: '' }); }} /></SettingRow>
    {appLock.enabled && !form && <div className="app-lock-row">
      <label className="toggle-row">自动锁定<select aria-label="自动锁定" value={appLock.minutes} onChange={event => appLock.setMinutes(Number(event.target.value))}>{LOCK_TIMEOUTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <button type="button" className="secondary-button" onClick={() => { onClose(); appLock.lock(); }}>立即锁定</button></div>}
    {form && <form className="app-lock-form" onSubmit={submit}>
      <input type="password" aria-label={form.mode === 'enable' ? '设置密码' : '当前密码'} placeholder={form.mode === 'enable' ? '设置密码（至少 4 位）' : '输入当前密码以关闭'} autoComplete={form.mode === 'enable' ? 'new-password' : 'current-password'} autoFocus value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} />
      {form.mode === 'enable' && <input type="password" aria-label="再输一次" placeholder="再输一次" autoComplete="new-password" value={form.confirm} onChange={event => setForm({ ...form, confirm: event.target.value })} />}
      {form.mode === 'enable' && <label className="toggle-row">自动锁定<select aria-label="自动锁定时间" value={form.minutes} onChange={event => setForm({ ...form, minutes: Number(event.target.value) })}>{LOCK_TIMEOUTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="account-actions"><button type="button" className="secondary-button" onClick={() => setForm(null)}>取消</button><button className="primary-button" disabled={busy || !form.password}>{form.mode === 'enable' ? '开启' : '关闭应用锁'}</button></div>
    </form>}
  </section>;
}

// 常用语：在输入框的附件菜单或「/」菜单里一键插入；存在服务端，换设备也在。
function PhraseSettings({ phrases, onChange, notify }) {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  async function save(next) {
    setBusy(true);
    try { await onChange(next); setInput(''); } catch (error) { notify(error.message); } finally { setBusy(false); }
  }
  const add = () => { const text = input.trim(); if (text && !phrases.includes(text)) save([...phrases, text]); else setInput(''); };
  return <section className="phrase-settings"><h4>常用语</h4>
    <p className="inline-note">在输入框点附件按钮选「常用语」，或输入「/」加关键字，就能插入。</p>
    {phrases.length > 0 && <ul className="phrase-list">{phrases.map(text => <li key={text}><span>{text}</span>
      <button type="button" className="icon-button" aria-label={`删除常用语 ${text.slice(0, 20)}`} disabled={busy} onClick={() => save(phrases.filter(item => item !== text))}><X size={13} /></button></li>)}</ul>}
    {phrases.length < 30 && <div className="phrase-add"><textarea aria-label="添加常用语" placeholder="比如：收到，马上处理" rows={2} maxLength={500} value={input} disabled={busy}
      onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) { event.preventDefault(); add(); } }} />
      <button type="button" className="secondary-button" disabled={busy || !input.trim()} onClick={add}>添加</button></div>}
  </section>;
}

function KeywordSettings({ keywords, onChange, notify }) {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  async function save(next) {
    setBusy(true);
    try { await onChange(next); setInput(''); } catch (error) { notify(error.message); } finally { setBusy(false); }
  }
  const add = () => { const word = input.trim(); if (word && !keywords.includes(word)) save([...keywords, word]); else setInput(''); };
  return <section className="keyword-settings"><h4>关键词提醒</h4>
    <p className="inline-note">别人的消息里出现这些词时，像被 @ 一样提醒你，免打扰的会话也会提醒。</p>
    <div className="keyword-chips">{keywords.map(word => <span key={word} className="keyword-chip">{word}<button type="button" aria-label={`删除关键词 ${word}`} disabled={busy} onClick={() => save(keywords.filter(item => item !== word))}><X size={12} /></button></span>)}
      <input aria-label="添加关键词" placeholder={keywords.length ? '再加一个' : '输入关键词后回车，如：上线'} maxLength={20} value={input} disabled={busy || keywords.length >= 20}
        onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); add(); } }} /></div>
  </section>;
}

// 勿扰：每天的固定时段，或临时暂停一阵子；只影响这台设备的系统通知，消息照常收到、未读照常计数。
function QuietSettings({ notify }) {
  const [quiet, setQuiet] = useState(readQuiet);
  const change = next => { const value = { ...quiet, ...next }; setQuiet(value); saveQuiet(value); };
  const pause = hours => { const until = hours ? Date.now() + hours * 3600000 : (() => { const date = new Date(); date.setHours(24, 0, 0, 0); return date.getTime(); })(); change({ until }); notify(`通知已暂停到 ${new Date(until).toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`); };
  const paused = quiet.until > Date.now();
  return <section className="device-settings quiet-settings"><h4>勿扰</h4>
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
  return <section className="device-settings"><h4>登录设备</h4>
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
  return <section className="storage-settings"><h4>聊天记录与存储</h4>
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
