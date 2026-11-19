import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Coins, Search, Trophy, UserPlus, X } from 'lucide-react';
import { api } from '../api';
import { Avatar } from '../components';
import './arcade-panels.css';

const num = value => Number(value || 0).toLocaleString('zh-CN');
const signed = value => `${value > 0 ? '+' : ''}${num(value)}`;
const KINDS = { initial: '初始筹码', transfer: '转账', mint: '管理员发放', buyin: '牌桌买入', cashout: '离桌退回', hand: '牌局结算', recovery: '未完成牌局退回' };

function People({ selected, onSelect, exclude = [], includeSelf }) {
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => api(`arcade/people?q=${encodeURIComponent(query)}`).then(data => { if (alive) { setPeople(data.users); setError(''); } }).catch(error => { if (alive) setError(error.message); }), 180);
    return () => { alive = false; clearTimeout(timer); };
  }, [query]);
  const rows = [...(includeSelf ? [includeSelf] : []), ...people].filter(user => !exclude.includes(user.id));
  return <div className="arcade-people"><label className="arcade-search"><Search size={15} /><input placeholder="搜索昵称" aria-label="搜索游戏好友" value={query} onChange={event => setQuery(event.target.value)} /></label>
    {error && <p role="alert" className="arcade-panel-error">{error}</p>}
    <div className="arcade-people-list">{rows.map(user => <button type="button" key={user.id} className={selected?.id === user.id ? 'selected' : ''} onClick={() => onSelect(user)}>
      <Avatar user={user} size={30} online={user.online} /><span>{user.name}{includeSelf?.id === user.id ? '（自己）' : ''}</span>{selected?.id === user.id && <Check size={16} />}
    </button>)}{!rows.length && <p className="arcade-panel-empty">没有找到其他用户</p>}</div>
  </div>;
}

export function InvitePanel({ table, onCommand, onClose, error }) {
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState('');
  const send = async () => {
    setBusy(true);
    if (await onCommand('invite', { id: table.id, userId: selected.id })) { setSent(`已邀请 ${selected.name}`); setSelected(null); }
    setBusy(false);
  };
  return <Sheet title="邀请好友" icon={<UserPlus size={20} />} onClose={onClose}><p className="arcade-sheet-subtitle">{table.name} · {table.players.length} / 6 人</p>
    <People selected={selected} onSelect={setSelected} exclude={table.players.map(player => player.id)} />
    {error && <p className="arcade-panel-error" role="alert">{error}</p>}
    {sent && <p className="arcade-panel-success" role="status">{sent}</p>}
    <button className="arcade-primary panel-submit" disabled={!selected || busy || table.players.length >= 6} onClick={send}>发送邀请<ArrowRight size={16} /></button>
  </Sheet>;
}

export function StakesPanel({ table, onCommand, onClose, error }) {
  const [base, setBase] = useState(String(table.smallBlind));
  const [hands, setHands] = useState(String(table.handLimit));
  const [busy, setBusy] = useState(false);
  const value = Number(base), limit = Number(hands), valid = Number.isSafeInteger(value) && value >= 1 && value <= 1000000 && hands !== '' && Number.isSafeInteger(limit) && limit >= 0 && limit <= 1000;
  const save = async event => {
    event.preventDefault(); if (!valid || busy) return;
    setBusy(true); const ok = await onCommand('stakes', { id: table.id, smallBlind: value, handLimit: limit }); setBusy(false); if (ok) onClose();
  };
  return <Sheet title="牌桌设置" icon={<Coins size={21} />} onClose={onClose}>
    <form className="arcade-transfer-form" onSubmit={save}><label>底分（小盲注）<input aria-label="牌桌底分" type="number" min="1" max="1000000" step="1" value={base} onChange={event => setBase(event.target.value)} required /></label>
      <div className="stake-presets">{[10, 50, 100, 500].map(amount => <button type="button" className={amount === value ? 'selected' : ''} key={amount} onClick={() => setBase(String(amount))}>{num(amount)}</button>)}</div>
      <div className="stake-preview"><span>小盲 / 大盲</span><b>{valid ? `${num(value)} / ${num(value * 2)}` : '—'}</b></div>
      <label>每场手数（0 为不限）<input aria-label="牌桌每场手数" type="number" min="0" max="1000" step="1" value={hands} onChange={event => setHands(event.target.value)} required /></label>
      <div className="stake-presets">{[0, 5, 10, 20].map(amount => <button type="button" className={amount === limit ? 'selected' : ''} key={amount} onClick={() => setHands(String(amount))}>{amount || '不限'}</button>)}</div>
      <p className="arcade-stat-note">调整后所有玩家重新准备；已有桌上筹码不变。下一次买入按 100 个大盲计算，余额不足时使用剩余可用筹码。</p>
      <p className="arcade-stat-note">本场已打 {table.matchHandNumber} 手。达到设定手数后暂停发牌，可由桌主开启下一场；每手仍按标准德州的四轮下注进行。</p>
      {error && <p className="arcade-panel-error" role="alert">{error}</p>}
      <button className="arcade-primary panel-submit" disabled={!valid || busy || !['waiting', 'showdown'].includes(table.phase)}>{busy ? '正在保存…' : '保存设置'}<Check size={16} /></button>
    </form>
  </Sheet>;
}

export function Sheet({ title, icon, onClose, children, wide = false }) {
  const root = useRef(null);
  useEffect(() => { const previous = document.activeElement; root.current?.querySelector('button')?.focus(); return () => previous?.focus?.(); }, []);
  return <div className="arcade-sheet-backdrop" onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
    if (event.key === 'Tab') {
      const controls = [...root.current.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]')].filter(node => node.getClientRects().length);
      const target = event.shiftKey && document.activeElement === controls[0] ? controls.at(-1) : !event.shiftKey && document.activeElement === controls.at(-1) ? controls[0] : null;
      if (target) { event.preventDefault(); target.focus(); }
    }
  }}>
    <section ref={root} className={`arcade-sheet ${wide ? 'wide' : ''}`} role="region" aria-label={title}><header><span>{icon}<h2>{title}</h2></span><button aria-label={`关闭${title}`} onClick={onClose}><X size={20} /></button></header><div className="arcade-sheet-body">{children}</div></section>
  </div>;
}

export function Leaderboard({ me, onClose }) {
  const [sort, setSort] = useState('net');
  const [rows, setRows] = useState(null);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    const load = () => api(`arcade/leaderboard?sort=${sort}`).then(data => { if (alive) { setRows(data.players); setError(''); } }).catch(error => { if (alive) setError(error.message); });
    load(); window.addEventListener('linliao:arcade-changed', load);
    return () => { alive = false; window.removeEventListener('linliao:arcade-changed', load); };
  }, [sort]);
  const user = rows?.find(row => row.id === selected);
  return <Sheet title="牌桌排行榜" icon={<Trophy size={21} />} onClose={onClose} wide>
    <div className="arcade-ranking-heading"><span>每一局，都有记录。</span><select aria-label="排行榜排序" value={sort} onChange={event => setSort(event.target.value)}><option value="net">净赢最多</option><option value="total">总筹码最多</option><option value="winRate">胜率最高</option><option value="hands">牌局最多</option><option value="won">累计赢得最多</option></select></div>
    {error && <p className="arcade-panel-error" role="alert">{error}</p>}
    {rows ? <div className="arcade-ranking-scroll"><table className="arcade-ranking"><thead><tr><th>排名 / 玩家</th><th>总筹码</th><th>净赢</th><th>胜率</th><th>获胜 / 局数</th></tr></thead><tbody>{rows.map(player => <tr key={player.id} className={player.id === me.id ? 'is-me' : ''}><td><button onClick={() => setSelected(player.id)} aria-label={`查看${player.name}的战绩`}><span className={`rank-number rank-${player.rank}`}>{String(player.rank).padStart(2, '0')}</span><Avatar user={player} size={30} /><b>{player.name}{player.id === me.id && <small>你</small>}</b></button></td><td>{num(player.total)}</td><td className={player.net > 0 ? 'positive' : player.net < 0 ? 'negative' : ''}>{signed(player.net)}</td><td>{player.hands ? `${player.winRate}%` : '—'}</td><td>{player.wins} / {player.hands}</td></tr>)}</tbody></table></div> : <p className="arcade-panel-empty">正在加载战绩…</p>}
    <p className="arcade-stat-note">胜率按赢得底池的局数统计，平分计入获胜。总筹码包含账户余额和牌桌筹码；转账与发放不计入净赢。</p>
    {user && <div className="arcade-stat-card"><header><Avatar user={user} size={36} /><b>{user.name}</b><button onClick={() => setSelected(null)} aria-label="收起战绩"><X size={17} /></button></header><dl>{[
      ['累计赢得', num(user.won)], ['累计投入', num(user.wagered)], ['最大单局净赢', signed(user.biggestWin)], ['平分底池', `${user.splits} 局`], ['摊牌', `${user.showdowns} 局`], ['弃牌', `${user.folds} 局`], ['全下', `${user.allIns} 局`], ['主动入池率', `${user.vpip}%`], ['加注局数', user.raises], ['最长连胜', `${user.bestStreak} 局`],
    ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></div>}
  </Sheet>;
}

export function WalletPanel({ me, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [mode, setMode] = useState('history');
  const [selected, setSelected] = useState(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const submission = useRef(null);
  const serial = useRef(0);
  useEffect(() => {
    let alive = true;
    const load = () => { const ticket = ++serial.current; return api('arcade/wallet').then(next => { if (alive && ticket === serial.current) setData(next); }).catch(error => { if (alive && ticket === serial.current) setError(error.message); }); };
    load(); window.addEventListener('linliao:arcade-changed', load);
    return () => { alive = false; ++serial.current; window.removeEventListener('linliao:arcade-changed', load); };
  }, []);
  const value = Number(amount);
  const valid = selected && Number.isSafeInteger(value) && value > 0 && value <= 1000000000 && (mode === 'mint' || value <= (data?.wallet.balance || 0));
  const submit = async event => {
    event.preventDefault();
    if (!valid || busy) return;
    if (!review) { setReview(true); return; }
    setBusy(true); setError(''); ++serial.current;
    const key = `${mode}:${selected.id}:${value}:${note}`;
    if (submission.current?.key !== key) submission.current = { key, requestId: crypto.randomUUID() };
    try {
      const next = await api(`arcade/${mode}`, { userId: selected.id, amount: value, note, requestId: submission.current.requestId });
      ++serial.current;
      setData(next); setSuccess(`已${mode === 'mint' ? '发放' : '转给'} ${selected.name} ${num(value)} 筹码`); setMode('history'); setAmount(''); setSelected(null); setNote(''); setReview(false); submission.current = null; onChanged();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  };
  const switchMode = next => { setMode(next); setReview(false); setError(''); setSuccess(''); setSelected(null); };
  return <Sheet title="我的筹码" icon={<Coins size={22} />} onClose={onClose}>
    <div className="arcade-wallet-balance"><span>可用筹码</span><strong>{data ? num(data.wallet.balance) : '—'}</strong><div><span>牌桌筹码 <b>{num(data?.wallet.reserved)}</b></span><span>总筹码 <b>{num(data?.wallet.total)}</b></span></div></div>
    <div className="arcade-panel-tabs">{[['history', '流水'], ['transfer', '转给好友'], ...(data?.canMint ? [['mint', '发放筹码']] : [])].map(([id, label]) => <button className={mode === id ? 'active' : ''} key={id} onClick={() => switchMode(id)}>{label}</button>)}</div>
    {error && <p className="arcade-panel-error" role="alert">{error}</p>}{success && <p className="arcade-panel-success" role="status">{success}</p>}
    {mode === 'history' ? <ol className="arcade-transactions">{data?.history.map(row => <li key={row.id}><span><b>{KINDS[row.kind] || row.kind}{row.peer && ` · ${row.peer}`}</b><small>{row.note && `${row.note} · `}{new Date(row.at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</small></span><strong className={row.amount > 0 ? 'positive' : row.amount < 0 ? 'negative' : ''}>{signed(row.amount)}</strong></li>)}</ol>
      : <form className="arcade-transfer-form" onSubmit={submit}>{review ? <div className="arcade-transfer-review"><Avatar user={selected} size={46} /><b>{selected.name}</b><span>{mode === 'mint' ? '发放' : '转账'}</span><strong>{num(value)}</strong><button type="button" className="arcade-text" disabled={busy} onClick={() => setReview(false)}><ArrowLeft size={14} />返回修改</button></div> : <>
        <People selected={selected} onSelect={setSelected} includeSelf={mode === 'mint' ? me : undefined} />
        <label>筹码数量<input aria-label="筹码数量" type="number" inputMode="numeric" min="1" max={mode === 'mint' ? 1000000000 : data?.wallet.balance || 0} step="1" required value={amount} onChange={event => setAmount(event.target.value)} /></label>
        <label>备注<input aria-label="转账备注" maxLength={80} value={note} onChange={event => setNote(event.target.value)} placeholder="选填" /></label>
      </>}<button className="arcade-primary panel-submit" disabled={!valid || busy}>{busy ? '正在处理…' : review ? `确认${mode === 'mint' ? '发放' : '转账'}` : '下一步'}<ArrowRight size={16} /></button></form>}
  </Sheet>;
}
