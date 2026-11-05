import { copyText } from './mobile/runtime';
import React, { useEffect, useState } from 'react';
import { ArrowRight, ShieldCheck, Clock3, LogOut, RefreshCw, KeyRound } from 'lucide-react';
import { api, nativeTitlebar } from './api';
import { Logo, IdentityFields, Modal, Avatar } from './components';
import { mobileClient, chooseServer } from './mobile/session';

const statusNames = { pending: '待审核', approved: '已通过', rejected: '已拒绝', suspended: '已停用' };
const roleNames = { user: '成员', admin: '管理员', super_admin: '超级管理员' };

export function PasswordForm({ required = false, onChanged }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault();
    if (password !== confirm) return setError('两次输入的新密码不一致');
    setBusy(true); setError('');
    try { await api('auth/password', { currentPassword, password }); await onChanged(); }
    catch (error) { setError(error.message); } finally { setBusy(false); }
  }
  return <form onSubmit={submit}>
    <label className="field-label" htmlFor="current-password">{required ? '初始密码' : '原密码'}</label>
    <input id="current-password" type="password" autoComplete="current-password" value={currentPassword} maxLength={128} required onChange={event => setCurrentPassword(event.target.value)} />
    <label className="field-label" htmlFor="new-password">新密码</label>
    <input id="new-password" type="password" autoComplete="new-password" placeholder="10–128 位，包含字母和数字" value={password} minLength={10} maxLength={128} required onChange={event => setPassword(event.target.value)} />
    <label className="field-label" htmlFor="confirm-password">确认新密码</label>
    <input id="confirm-password" type="password" autoComplete="new-password" value={confirm} minLength={10} maxLength={128} required onChange={event => setConfirm(event.target.value)} />
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="primary-button full account-submit" disabled={busy}>{busy ? '正在保存…' : '保存新密码'}<ArrowRight size={16} /></button>
  </form>;
}

export default function Account({ bootstrap, onChanged, onLogout, loggingOut }) {
  const [register, setRegister] = useState(false);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState('cat');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const account = bootstrap.account;
  useEffect(() => {
    if (account?.status !== 'pending') return;
    const timer = setInterval(onChanged, 15000);
    return () => clearInterval(timer);
  }, [account?.status, onChanged]);
  async function submit(event) {
    event.preventDefault();
    if (register && password !== confirm) return setError('两次输入的密码不一致');
    setBusy(true); setError('');
    try { await api(`auth/${register ? 'register' : 'login'}`, { identifier, password, ...(register ? { name, avatar } : {}) }); setPassword(''); setConfirm(''); await onChanged(); }
    catch (error) { setError(error.message); } finally { setBusy(false); }
  }
  return <div className={`onboarding ${nativeTitlebar ? 'native' : ''}`} data-screen-label="登录虾扯蛋">
    {nativeTitlebar && <div className="drag-strip" data-drag-region aria-hidden="true" />}
    <section className="welcome-story"><div className="welcome-brand"><Logo /><span>虾扯蛋</span></div>
      <h1>有事说事，<br />没事虾扯蛋。</h1><p className="story-description">发个想法，丢张照片，和熟悉的人扯两句。</p>
      <p className="story-footer"><ShieldCheck size={14} />经管理员审核后加入</p>
    </section>
    <section className="welcome-panel glass"><div className="setup-form">
      {account ? <>
        {account.mustChangePassword && account.status === 'approved' ? <><span className="success-icon"><KeyRound size={22} /></span><h2>设置你的登录密码</h2><p className="form-description">首次登录，请将初始密码换成自己的密码。</p><PasswordForm required onChanged={onChanged} /></> : <>
          <span className="success-icon"><Clock3 size={22} /></span><h2>{account.status === 'pending' ? '申请已提交' : `账号${statusNames[account.status] || '暂不可用'}`}</h2>
          <p className="form-description">{account.status === 'pending' ? `${account.name}，管理员通过申请后，就可以进入聊天了。` : account.status === 'rejected' ? '注册申请未通过，请联系管理员。' : '账号已暂停使用，请联系管理员。'}</p>
          <div className="account-summary"><Avatar user={account} size={40} /><span className="account-summary-copy"><b>{account.name}</b><small>{account.phone || account.email}</small></span><span className="account-status">{statusNames[account.status]}</span></div>
          <button className="secondary-button full" disabled={busy} onClick={onChanged}><RefreshCw size={15} />刷新审核状态</button>
        </>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="text-button back-link" disabled={busy || loggingOut} onClick={onLogout}><LogOut size={14} />{loggingOut ? '正在退出…' : '退出登录'}</button>
      </> : <>
        <h2>{register ? '加入聊天空间' : '欢迎回来'}</h2><p className="form-description">{register ? '创建账号，审核通过后就能和大家见面。' : '登录账号，接着聊。'}</p>
        <div className="segmented-control" role="group" aria-label="登录或注册">{[false, true].map(value => <button key={String(value)} type="button" className={register === value ? 'active' : ''} aria-pressed={register === value} disabled={busy} onClick={() => { setRegister(value); setPassword(''); setConfirm(''); setError(''); }}>{value ? '注册' : '登录'}</button>)}</div>
        <form onSubmit={submit}>
          <label className="field-label" htmlFor="account-identifier">手机号或邮箱</label>
          <input id="account-identifier" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="输入手机号或邮箱" value={identifier} maxLength={254} required onChange={event => setIdentifier(event.target.value)} />
          <label className="field-label" htmlFor="account-password">密码</label>
          <input id="account-password" name="password" type="password" autoComplete={register ? 'new-password' : 'current-password'} placeholder={register ? '10–128 位，包含字母和数字' : '输入密码'} value={password} minLength={register ? 10 : undefined} maxLength={128} required onChange={event => setPassword(event.target.value)} />
          {register && <><label className="field-label" htmlFor="register-confirm">确认密码</label><input id="register-confirm" type="password" autoComplete="new-password" value={confirm} minLength={10} maxLength={128} required onChange={event => setConfirm(event.target.value)} /><IdentityFields {...{ name, setName, avatar, setAvatar }} /></>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button full account-submit" disabled={busy}>{busy ? '请稍等…' : register ? '注册并提交审核' : '登录'}<ArrowRight size={16} /></button>
        </form>
      </>}
      {mobileClient && <button type="button" className="mobile-server-link text-button" onClick={chooseServer}>连接服务器</button>}
    </div></section>
  </div>;
}

export function AdminDialog({ me, onClose, onUpdated, notify }) {
  const [status, setStatus] = useState('pending');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const [confirmRole, setConfirmRole] = useState(null);
  const [confirmReset, setConfirmReset] = useState(null);
  const [issued, setIssued] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    api(`admin/users?status=${status}&page=${page}`).then(value => { if (!cancelled) setResult(value); }).catch(error => { if (!cancelled) setError(error.message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [status, page, version]);
  async function update(user, change) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      await api(change.role ? 'admin/role' : 'admin/review', { userId: user.id, ...change });
      setConfirmRole(null); setVersion(value => value + 1); await onUpdated(); notify('账号状态已更新');
    } catch (error) { setError(error.message); } finally { setBusy(false); }
  }
  async function resetPassword(user) {
    if (busy) return;
    if (confirmReset !== user.id) return setConfirmReset(user.id);
    setBusy(true); setError('');
    try { const { password } = await api('admin/password', { userId: user.id }); setConfirmReset(null); setIssued({ name: user.name, password }); }
    catch (error) { setError(error.message); } finally { setBusy(false); }
  }
  async function copyPassword() {
    try { await (window.desktop ? window.desktop.copy(issued.password) : copyText(issued.password)); notify('临时密码已复制'); }
    catch { setError('复制失败，请手动选中复制'); }
  }
  return <Modal title="用户管理" subtitle="审核注册申请，管理成员权限。" wide onClose={onClose}>
    <div className="account-tabs" role="group" aria-label="审核状态">{Object.entries(statusNames).map(([key, label]) => <button className={`secondary-button ${status === key ? 'selected' : ''}`} aria-pressed={status === key} disabled={busy} key={key} onClick={() => { setStatus(key); setPage(1); setConfirmRole(null); }}>{label}</button>)}<button className="text-button" disabled={busy || loading} onClick={() => setVersion(value => value + 1)} aria-label="刷新用户列表"><RefreshCw size={15} /></button></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {issued && <section className="webhook-issued" aria-live="polite"><b>{issued.name} 的临时密码</b><input aria-label="临时密码" value={issued.password} readOnly onFocus={event => event.target.select()} />
      <button type="button" className="primary-button full" onClick={copyPassword}>复制临时密码</button>
      <p className="inline-note">只显示这一次。请私下告诉对方，对方登录后需要先设置新密码；原来的登录已全部退出。</p></section>}
    {loading ? <p className="compact-empty" role="status">正在加载…</p> : <>
      <div className="account-list">{result?.users.map(user => {
        const editable = user.id !== me.id && user.role !== 'super_admin' && (me.role === 'super_admin' || user.role === 'user');
        return <div className="account-row" key={user.id}><Avatar user={user} size={36} /><div className="account-person"><b>{user.name}</b><span>{user.phone || user.email}</span><small>{roleNames[user.role]} · {new Date(user.createdAt).toLocaleDateString('zh-CN')}</small></div>
          {editable && <div className="account-actions">
            {user.status !== 'approved' && <button className="primary-button" disabled={busy} onClick={() => update(user, { status: 'approved' })}>{user.status === 'suspended' ? '恢复使用' : '通过'}</button>}
            {user.status === 'pending' && <button className="secondary-button" disabled={busy} onClick={() => update(user, { status: 'rejected' })}>拒绝</button>}
            {user.status === 'approved' && <button className="secondary-button" disabled={busy} onClick={() => update(user, { status: 'suspended' })}>停用</button>}
            {['approved', 'suspended'].includes(user.status) && <button className="text-button" disabled={busy} onClick={() => resetPassword(user)}>{confirmReset === user.id ? '确认重置密码' : '重置密码'}</button>}
            {me.role === 'super_admin' && user.status === 'approved' && <button className="text-button" disabled={busy} onClick={() => confirmRole === user.id ? update(user, { role: user.role === 'admin' ? 'user' : 'admin' }) : setConfirmRole(user.id)}>{confirmRole === user.id ? '确认修改权限' : user.role === 'admin' ? '设为普通成员' : '设为管理员'}</button>}
          </div>}
        </div>;
      })}{!result?.users.length && <div className="compact-empty"><ShieldCheck size={25} /><p>{status === 'pending' ? '暂时没有待审核的申请' : '暂无此状态的用户'}</p></div>}</div>
      {result?.total > 50 && <div className="account-pagination"><button className="secondary-button" disabled={page === 1 || busy} onClick={() => setPage(value => value - 1)}>上一页</button><span>第 {page} 页 · 共 {result.total} 人</span><button className="secondary-button" disabled={page * 50 >= result.total || busy} onClick={() => setPage(value => value + 1)}>下一页</button></div>}
    </>}
  </Modal>;
}
