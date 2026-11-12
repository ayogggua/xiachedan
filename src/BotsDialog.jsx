import React, { useEffect, useState } from 'react';
import { Bot, Copy, Plus } from 'lucide-react';
import { api, absoluteUrl } from './api';
import { copyText } from './mobile/runtime';
import { Modal, Avatar, AvatarPicker } from './components';
import { ConfirmDialog } from './dialogs';

const STATUS = { enabled: '启用中', disabled: '已停用', failed: '投递失败，已自动停用' };
const when = time => new Date(time).toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const copy = async (text, notify, label) => {
  try { await (window.desktop?.copy ? window.desktop.copy(text) : copyText(text)); notify(`${label}已复制`); }
  catch { notify('复制失败，请选中后手动复制'); }
};

function Switch({ label, checked, onChange, disabled = false }) {
  return <button type="button" role="switch" aria-label={label} aria-checked={checked} disabled={disabled} className={`switch ${checked ? 'enabled' : ''}`} onClick={() => onChange(!checked)}><i className="switch-track"><i /></i></button>;
}

// 新建或编辑机器人：名字、头像、简介、回调地址和「接收全部消息」。
function BotForm({ bot, onCancel, onSaved }) {
  const [name, setName] = useState(bot?.name || '');
  const [avatar, setAvatar] = useState(bot?.avatar || 'bot');
  const [bio, setBio] = useState(bot?.bio || '');
  const [callbackUrl, setCallbackUrl] = useState(bot?.callbackUrl || '');
  const [receiveAll, setReceiveAll] = useState(Boolean(bot?.receiveAll));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { await onSaved(await api(bot ? 'bots/update' : 'bots', { ...(bot ? { id: bot.id } : {}), name, avatar, bio, callbackUrl, receiveAll })); }
    catch (failure) { setError(failure.message); setBusy(false); }
  }
  return <form className="bot-form" onSubmit={submit}><fieldset disabled={busy}>
    <div className="profile-avatar"><Avatar user={{ avatar }} size={64} /></div>
    <label className="field-label" htmlFor="bot-name">名字</label>
    <input id="bot-name" autoFocus value={name} maxLength={24} required placeholder="例如：值班助手" onChange={event => setName(event.target.value)} />
    <AvatarPicker avatar={avatar} setAvatar={setAvatar} extras={['bot']} />
    <label className="field-label" htmlFor="bot-bio">简介（可选）</label>
    <input id="bot-bio" value={bio} maxLength={120} placeholder="一句话说明它能做什么" onChange={event => setBio(event.target.value)} />
    <label className="field-label" htmlFor="bot-callback">回调地址（可选）</label>
    <input id="bot-callback" type="url" inputMode="url" value={callbackUrl} maxLength={2048} placeholder="https://example.com/xiachedan-bot" spellCheck={false} autoComplete="off" onChange={event => setCallbackUrl(event.target.value)} aria-describedby="bot-callback-hint" />
    <small className="field-hint" id="bot-callback-hint">发给机器人的消息会以签名的 JSON 推送到这里。不填就只能发、不能收。</small>
    <div className="setting-row bot-receive-all"><span><b>接收全部消息</b><small>默认只收群聊和大厅里 @它的消息，私聊里总是收全部。打开后它所在的群聊和大厅里所有消息都会发给它，群里会显示提示。</small></span>
      <Switch label="接收全部消息" checked={receiveAll} onChange={setReceiveAll} /></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="modal-footer"><button type="button" className="secondary-button" onClick={onCancel}>取消</button><button className="primary-button" disabled={!name.trim()}>{busy ? '正在保存…' : bot ? '保存修改' : '创建机器人'}</button></div>
  </fieldset></form>;
}

// 令牌和签名密钥只在创建、重置时显示这一次。
function Credentials({ issued, notify, onDone }) {
  return <section className="webhook-issued bot-credentials" aria-live="polite" aria-label={`「${issued.name}」的令牌和签名密钥`}>
    <b>「{issued.name}」的令牌和签名密钥</b>
    <label className="field-label" htmlFor="bot-token">令牌（调用发消息接口时放在 Authorization: Bearer 后面）</label>
    <span className="bot-secret-row"><input id="bot-token" value={issued.token} readOnly onFocus={event => event.target.select()} /><button type="button" className="secondary-button" onClick={() => copy(issued.token, notify, '令牌')}><Copy size={14} />复制</button></span>
    <label className="field-label" htmlFor="bot-secret">签名密钥（校验推送来的事件）</label>
    <span className="bot-secret-row"><input id="bot-secret" value={issued.secret} readOnly onFocus={event => event.target.select()} /><button type="button" className="secondary-button" onClick={() => copy(issued.secret, notify, '签名密钥')}><Copy size={14} />复制</button></span>
    <p className="inline-note">只显示这一次，请马上保存到机器人程序里；泄露后点「重置凭证」，旧的立即失效。发消息接口：<code>POST {absoluteUrl('/api/bot/v1/messages')}</code>，用法见项目说明里的「机器人接口」。</p>
    <button type="button" className="text-button" onClick={onDone}>我已保存</button>
  </section>;
}

// 空间管理者的机器人管理：列表、新建、编辑、停用/启用、重置凭证、测试事件、删除。
export function BotsDialog({ notify, onClose, onChanged }) {
  const [bots, setBots] = useState(null);
  const [view, setView] = useState('list');
  const [issued, setIssued] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  // 列表和表单来回切换时焦点不掉到页面上：进表单落在名字输入框（autoFocus），回列表落在当初点的那个按钮。
  const [focusKey, setFocusKey] = useState(null);
  useEffect(() => {
    if (view !== 'list' || !focusKey || !bots || confirm) return;
    document.querySelector(`dialog[open] [data-focus-key="${CSS.escape(focusKey)}"]`)?.focus();
    setFocusKey(null);
  }, [view, focusKey, bots, confirm]);
  const openForm = key => { setFocusKey(key === 'new' ? 'new' : `edit:${key}`); setView(key); };
  const load = () => api('bots').then(result => setBots(result.bots)).catch(failure => setError(failure.message));
  useEffect(() => { load(); }, []);
  async function run(key, action) {
    setBusy(key); setError('');
    try { await action(); await load(); await onChanged?.(); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(''); }
  }
  const test = bot => run(`test:${bot.id}`, async () => {
    const result = await api('bots/test', { id: bot.id });
    notify(result.ok ? `测试事件已送达（HTTP ${result.status}）` : `测试事件没有送达：${result.error}`);
  });
  const toggle = bot => run(`status:${bot.id}`, async () => { const enabled = bot.status !== 'enabled'; await api('bots/status', { id: bot.id, enabled }); notify(enabled ? `已启用「${bot.name}」` : `已停用「${bot.name}」`); });
  const editing = view !== 'list' && view !== 'new' ? bots?.find(bot => bot.id === view) : null;
  const form = view === 'new' || editing;
  // 列表和表单在同一个弹窗里切换，焦点和弹窗层级不跳。
  return <><Modal title={form ? editing ? `编辑「${editing.name}」` : '新建机器人' : '机器人'} wide={!form} className="bots-dialog" onClose={form ? () => setView('list') : onClose}
    subtitle={form ? '机器人是空间里的独立成员：可以被拉进群、和成员私聊。' : '机器人是空间里的独立成员，带「机器人」标记。群主或群管理员可以把它拉进群，成员可以和它私聊；发给它的消息推送到它的回调地址。'}>
    {form ? <BotForm key={view} bot={editing} onCancel={() => setView('list')} onSaved={async result => {
      if (result.token) setIssued({ name: result.bot.name, token: result.token, secret: result.secret });
      notify(editing ? '机器人已更新' : '机器人已创建'); setView('list'); await load(); await onChanged?.();
    }} /> : <>
    {issued && <Credentials issued={issued} notify={notify} onDone={() => setIssued(null)} />}
    {error && <p className="form-error" role="alert">{error}</p>}
    {!bots ? <p className="inline-note">正在加载…</p> : !bots.length ? <p className="inline-note">还没有机器人。</p> : <ul className="bot-list">{bots.map(bot => <li key={bot.id} className="bot-item">
      <Avatar user={bot} size={36} />
      <div className="bot-info">
        <b>{bot.name}</b>
        <span className="bot-badges"><span className={`bot-status ${bot.status}`}>{STATUS[bot.status] || bot.status}</span>{bot.receiveAll && <span className="bot-status listening">接收全部消息</span>}</span>
        <small>{bot.callbackUrl ? <>回调：<span className="bot-url">{bot.callbackUrl}</span></> : '没有回调地址，只能发消息'}</small>
        <small>{bot.rooms.length ? `在${bot.rooms.map(room => room.kind === 'public' ? '大厅' : `「${room.name}」`).join('、')}` : '还没有加入群聊或大厅'}{bot.lastDeliveredAt ? ` · 最近送达 ${when(bot.lastDeliveredAt)}` : ''}</small>
        {bot.lastError && <small className="bot-error" role={bot.status === 'failed' ? 'alert' : undefined}>最近错误（{when(bot.lastErrorAt)}）：{bot.lastError}</small>}
      </div>
      <div className="bot-actions">
        <button type="button" className="text-button" data-focus-key={`edit:${bot.id}`} disabled={Boolean(busy)} onClick={() => openForm(bot.id)}>编辑</button>
        {bot.callbackUrl && <button type="button" className="text-button" disabled={Boolean(busy)} onClick={() => test(bot)}>{busy === `test:${bot.id}` ? '正在发送…' : '发送测试事件'}</button>}
        <button type="button" className="text-button" disabled={Boolean(busy)} onClick={() => toggle(bot)}>{bot.status === 'enabled' ? '停用' : '启用'}</button>
        <button type="button" className="text-button" disabled={Boolean(busy)} onClick={() => setConfirm({ type: 'reset', bot })}>重置凭证</button>
        <button type="button" className="text-button danger-text" disabled={Boolean(busy)} onClick={() => setConfirm({ type: 'delete', bot })}>删除</button>
      </div>
    </li>)}</ul>}
    <div className="modal-footer"><button type="button" className="primary-button" data-focus-key="new" onClick={() => openForm('new')}><Plus size={15} />新建机器人</button></div>
    </>}
  </Modal>
    {confirm?.type === 'reset' && <ConfirmDialog title={`重置「${confirm.bot.name}」的令牌和签名密钥？`} subtitle="旧的令牌立即失效，机器人程序要换上新的令牌和签名密钥才能继续收发消息。" confirmLabel="重置" busyLabel="正在重置…"
      onConfirm={async () => { const result = await api('bots/reset', { id: confirm.bot.id }); setIssued({ name: confirm.bot.name, ...result }); }} onClose={() => setConfirm(null)} />}
    {confirm?.type === 'delete' && <ConfirmDialog title={`删除机器人「${confirm.bot.name}」？`} subtitle="它会退出所有群聊和大厅，令牌立即失效。以前发过的消息会保留，显示为已删除的机器人；和它的私聊记录还在，但不能再发消息。" confirmLabel="删除" busyLabel="正在删除…" danger
      onConfirm={async () => { await api('bots/delete', { id: confirm.bot.id }); if (issued?.name === confirm.bot.name) setIssued(null); notify(`已删除机器人「${confirm.bot.name}」`); await load(); await onChanged?.(); setFocusKey('new'); }} onClose={() => setConfirm(null)} />}
  </>;
}

// 把机器人拉进群聊或大厅：只列出启用中、还没在这里的机器人；会接收全部消息的提前说清楚。
export function RoomBotsDialog({ room, bots, onClose, onAdded, notify }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const candidates = bots.filter(bot => !bot.removed && bot.bot.status === 'enabled' && !(room.bots || []).includes(bot.id));
  async function add(bot) {
    setBusy(bot.id); setError('');
    try { await api('room-bots', { roomId: room.id, botId: bot.id, add: true }); await onAdded(); notify(`已把「${bot.name}」加入${room.kind === 'public' ? '大厅' : '群聊'}`); onClose(); }
    catch (failure) { setError(failure.message); setBusy(''); }
  }
  return <Modal title={`添加机器人到${room.kind === 'public' ? '大厅' : `「${room.name}」`}`} subtitle="默认只有 @它的消息会发给它。群里会出现一行提示，告诉大家机器人加入了。" onClose={() => !busy && onClose()}>
    {error && <p className="form-error" role="alert">{error}</p>}
    {candidates.length ? <ul className="bot-list bot-picker">{candidates.map(bot => <li key={bot.id} className="bot-item">
      <Avatar user={bot} size={36} />
      <div className="bot-info"><b>{bot.name}</b>{bot.bio && <small>{bot.bio}</small>}
        {bot.bot.receiveAll && <small className="bot-warning">会接收这里的全部消息，不只是 @它的</small>}</div>
      <button type="button" className="primary-button" disabled={Boolean(busy)} onClick={() => add(bot)}>{busy === bot.id ? '正在添加…' : '添加'}</button>
    </li>)}</ul> : <div className="compact-empty"><Bot size={25} /><p>没有可以添加的机器人。机器人由管理员在「设置 · 空间」里创建。</p></div>}
  </Modal>;
}
