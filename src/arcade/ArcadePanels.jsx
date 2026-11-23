import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, ChevronDown, Coins, Copy, Globe, Lock, RefreshCw, Search, SlidersHorizontal, Trophy, UserPlus, X } from 'lucide-react';
import { api, uid } from '../api';
import { Avatar } from '../components';
import { copyText } from '../mobile/runtime';
import { useIsMobile } from '../mobile/ui';
import './arcade-panels.css';

const num = value => Number(value || 0).toLocaleString('zh-CN');
const signed = value => `${value > 0 ? '+' : ''}${num(value)}`;
const KINDS = { initial: '初始筹码', transfer: '转账', mint: '管理员发放', buyin: '牌桌买入', cashout: '离桌退回', hand: '德州结算', baccarat: '百家乐结算', recovery: '未完成牌局退回' };

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

export function InvitePanel({ table, onCommand, onClose, error, maxPlayers = 6 }) {
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState('');
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const copyTimer = useRef(0);
  useEffect(() => () => clearTimeout(copyTimer.current), []);
  const count = table.players?.length || 0;
  const full = Boolean(maxPlayers && count >= maxPlayers);
  const copyCode = async () => {
    if (!table.roomCode) return;
    setCopyError('');
    try {
      await copyText(table.roomCode);
      setCopied(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopyError('复制失败，请手动记录上方房间口令');
    }
  };
  const send = async () => {
    setBusy(true);
    if (await onCommand('invite', { id: table.id, userId: selected.id })) { setSent(`已邀请 ${selected.name}`); setSelected(null); }
    setBusy(false);
  };
  return <Sheet title="邀请好友" icon={<UserPlus size={20} />} onClose={onClose}>
    <p className="arcade-sheet-subtitle">{table.name}{table.visibility === 'private' ? ' · 私密牌桌' : ''} · {maxPlayers ? `${count} / ${maxPlayers} 人` : `当前 ${count} 人在桌`}</p>
    {table.visibility === 'private' && table.roomCode && (
      <div className="arcade-code-card">
        <div className="arcade-code-meta">
          <span><Lock size={13} />房间口令</span>
          <strong>{table.roomCode}</strong>
        </div>
        <button type="button" className="arcade-secondary arcade-code-action" onClick={copyCode}>
          {copied ? <><Check size={14} />已复制</> : <><Copy size={14} />复制口令</>}
        </button>
      </div>
    )}
    {copyError && <p className="arcade-panel-error" role="alert">{copyError}</p>}
    <People selected={selected} onSelect={setSelected} exclude={(table.players || []).map(player => player.id)} />
    {error && <p className="arcade-panel-error" role="alert">{error}</p>}
    {sent && <p className="arcade-panel-success" role="status">{sent}</p>}
    <button className="arcade-primary panel-submit" disabled={!selected || busy || full} onClick={send}>发送邀请<ArrowRight size={16} /></button>
  </Sheet>;
}

export function StakesPanel({ table, onCommand, onClose, error }) {
  const [base, setBase] = useState(String(table.smallBlind));
  const [hands, setHands] = useState(String(table.handLimit));
  const [visibility, setVisibility] = useState(table.visibility === 'private' ? 'private' : 'public');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState('');
  const [copyError, setCopyError] = useState('');
  const copyTimer = useRef(0);
  useEffect(() => () => clearTimeout(copyTimer.current), []);
  const canEdit = ['waiting', 'showdown'].includes(table.phase);
  const value = Number(base), limit = Number(hands), valid = Number.isSafeInteger(value) && value >= 1 && value <= 1000000 && hands !== '' && Number.isSafeInteger(limit) && limit >= 0 && limit <= 1000;
  const copyCode = async () => {
    if (!table.roomCode) return;
    setCopyError('');
    try {
      await copyText(table.roomCode);
      setCopied(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopyError('复制失败，请手动记录上方房间口令');
    }
  };
  const resetCode = async () => {
    if (busy || !canEdit || table.visibility !== 'private') return;
    setBusy(true); setNotice(''); setCopyError('');
    const ok = await onCommand('stakes', { id: table.id, resetCode: true });
    setBusy(false);
    if (ok) { setCopied(false); setNotice('房间口令已重置，旧口令将失效'); }
  };
  const save = async event => {
    event.preventDefault(); if (!valid || busy || !canEdit) return;
    setBusy(true); setNotice('');
    const ok = await onCommand('stakes', { id: table.id, smallBlind: value, handLimit: limit, visibility });
    setBusy(false); if (ok) onClose();
  };
  return <Sheet title="牌桌设置" icon={<SlidersHorizontal size={20} />} onClose={onClose}>
    <form className="arcade-transfer-form" onSubmit={save}>
      <div className="create-visibility-field">
        <span className="create-field-label">房间类型</span>
        <div className="visibility-picker" role="radiogroup" aria-label="房间类型">
          <button type="button" role="radio" aria-checked={visibility === 'public'} disabled={busy || !canEdit} className={`visibility-option ${visibility === 'public' ? 'selected' : ''}`} onClick={() => setVisibility('public')}>
            <span className="visibility-option-head"><Globe size={15} /><b>公开牌桌</b></span>
            <small>大厅可见，所有成员可进入</small>
          </button>
          <button type="button" role="radio" aria-checked={visibility === 'private'} disabled={busy || !canEdit} className={`visibility-option ${visibility === 'private' ? 'selected' : ''}`} onClick={() => setVisibility('private')}>
            <span className="visibility-option-head"><Lock size={15} /><b>私密牌桌</b></span>
            <small>大厅隐藏，凭邀请或口令进入</small>
          </button>
        </div>
      </div>
      {table.visibility === 'private' && visibility === 'private' && table.roomCode && (
        <div className="arcade-code-card compact">
          <div className="arcade-code-meta">
            <span><Lock size={13} />当前口令</span>
            <strong>{table.roomCode}</strong>
          </div>
          <div className="arcade-code-buttons">
            <button type="button" className="arcade-secondary arcade-code-action" onClick={copyCode}>{copied ? <><Check size={14} />已复制</> : <><Copy size={14} />复制</>}</button>
            <button type="button" className="arcade-secondary arcade-code-action" disabled={busy || !canEdit} onClick={resetCode}><RefreshCw size={14} />重置</button>
          </div>
        </div>
      )}
      {visibility !== (table.visibility || 'public') && (
        <p className="arcade-stat-note is-highlight">{visibility === 'private' ? '保存后将从大厅隐藏并生成新的房间口令，已在桌玩家不受影响。' : '保存后所有成员均可在大厅看到并进入该牌桌。'}</p>
      )}
      {notice && <p className="arcade-panel-success" role="status">{notice}</p>}
      {copyError && <p className="arcade-panel-error" role="alert">{copyError}</p>}
      <label>底分（小盲注）<input aria-label="牌桌底分" type="number" min="1" max="1000000" step="1" value={base} onChange={event => setBase(event.target.value)} required /></label>
      <div className="stake-presets">{[10, 50, 100, 500].map(amount => <button type="button" className={amount === value ? 'selected' : ''} key={amount} onClick={() => setBase(String(amount))}>{num(amount)}</button>)}</div>
      <div className="stake-preview"><span>小盲 / 大盲</span><b>{valid ? `${num(value)} / ${num(value * 2)}` : '—'}</b></div>
      <label>每场手数（0 为不限）<input aria-label="牌桌每场手数" type="number" min="0" max="1000" step="1" value={hands} onChange={event => setHands(event.target.value)} required /></label>
      <div className="stake-presets">{[0, 5, 10, 20].map(amount => <button type="button" className={amount === limit ? 'selected' : ''} key={amount} onClick={() => setHands(String(amount))}>{amount || '不限'}</button>)}</div>
      <p className="arcade-stat-note">调整底分或手数后所有玩家重新准备；仅切换公开/私密不影响准备状态。下一次买入按 100 个大盲计算，余额不足时使用剩余可用筹码。</p>
      <p className="arcade-stat-note">本场已打 {table.matchHandNumber} 手。达到设定手数后暂停发牌，可由桌主开启下一场；每手仍按标准德州的四轮下注进行。</p>
      {error && <p className="arcade-panel-error" role="alert">{error}</p>}
      <button className="arcade-primary panel-submit" disabled={!valid || busy || !canEdit}>{busy ? '正在保存…' : '保存设置'}<Check size={16} /></button>
    </form>
  </Sheet>;
}

export function Sheet({ title, icon, onClose, children, wide = false }) {
  const root = useRef(null);
  const mobile = useIsMobile();
  useEffect(() => { const previous = document.activeElement; if (!mobile) root.current?.querySelector('button')?.focus(); return () => previous?.focus?.(); }, [mobile]);
  return <div className="arcade-sheet-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
    if (event.key === 'Tab') {
      const controls = [...root.current.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]')].filter(node => node.getClientRects().length);
      const target = event.shiftKey && document.activeElement === controls[0] ? controls.at(-1) : !event.shiftKey && document.activeElement === controls.at(-1) ? controls[0] : null;
      if (target) { event.preventDefault(); target.focus(); }
    }
  }}>
    <section ref={root} className={`arcade-sheet ${wide ? 'wide' : ''}`} role="region" aria-label={title}><span className="arcade-sheet-grabber" aria-hidden="true" /><header><span>{icon}<h2>{title}</h2></span><button aria-label={`关闭${title}`} onClick={onClose}><X size={20} /></button></header><div className="arcade-sheet-body">{children}</div></section>
  </div>;
}

export function Leaderboard({ me, onClose, initialGame = 'poker' }) {
  const mobile = useIsMobile();
  const [gameTab, setGameTab] = useState(initialGame === 'baccarat' ? 'baccarat' : 'poker');
  const [sort, setSort] = useState('net');
  const [rows, setRows] = useState(null);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');
  const serial = useRef(0);
  useEffect(() => {
    let alive = true;
    const load = () => {
      const ticket = ++serial.current;
      api(`arcade/leaderboard?game=${gameTab}&sort=${sort}`)
        .then(data => { if (alive && ticket === serial.current) { setRows(data.players); setError(''); } })
        .catch(error => { if (alive && ticket === serial.current) setError(error.message); });
    };
    load(); window.addEventListener('linliao:arcade-changed', load);
    return () => { alive = false; ++serial.current; window.removeEventListener('linliao:arcade-changed', load); };
  }, [sort, gameTab]);
  const user = rows?.find(row => row.id === selected);
  const statsFor = target => gameTab === 'baccarat' ? [
    ['累计派彩', num(target.won)], ['累计下注', num(target.wagered)], ['最大单局净赢', signed(target.biggestWin)], ['和局退本', `${target.pushes} 局`], ['押庄胜', `${target.bankerWins} 局`], ['押闲胜', `${target.playerWins} 局`], ['押和胜', `${target.tieWins} 局`], ['押对子胜', `${target.pairWins} 局`], ['幸运 6 胜', `${target.lucky6Wins} 局`], ['最长连胜', `${target.bestStreak} 局`],
  ] : [
    ['累计赢得', num(target.won)], ['累计投入', num(target.wagered)], ['最大单局净赢', signed(target.biggestWin)], ['平分底池', `${target.splits} 局`], ['摊牌', `${target.showdowns} 局`], ['弃牌', `${target.folds} 局`], ['全下', `${target.allIns} 局`], ['主动入池率', `${target.vpip}%`], ['加注局数', target.raises], ['最长连胜', `${target.bestStreak} 局`],
  ];
  return <Sheet title="牌桌排行榜" icon={<Trophy size={21} />} onClose={onClose} wide>
    <div className="arcade-panel-tabs">
      {[['poker', '德州扑克'], ['baccarat', '澳门百家乐']].map(([id, label]) => (
        <button key={id} className={gameTab === id ? 'active' : ''} onClick={() => { setGameTab(id); setSelected(null); }}>{label}</button>
      ))}
    </div>
    <div className="arcade-ranking-heading"><span>{gameTab === 'baccarat' ? '澳门百家乐战绩榜' : '无限注德州战绩榜'}</span><select aria-label="排行榜排序" value={sort} onChange={event => setSort(event.target.value)}><option value="net">净赢最多</option><option value="total">总筹码最多</option><option value="winRate">胜率最高</option><option value="hands">牌局最多</option><option value="won">{gameTab === 'baccarat' ? '累计派彩最多' : '累计赢得最多'}</option></select></div>
    {error && <p className="arcade-panel-error" role="alert">{error}</p>}
    {rows ? mobile ? <div className="arcade-ranking-cards">{rows.map(player => {
      const expanded = selected === player.id;
      return <div key={player.id} className={`arcade-rank-card ${player.id === me.id ? 'is-me' : ''} ${expanded ? 'is-open' : ''}`}>
        <button type="button" className="arcade-rank-row" aria-expanded={expanded} onClick={() => setSelected(expanded ? null : player.id)}>
          <span className={`rank-number rank-${player.rank}`}>{String(player.rank).padStart(2, '0')}</span>
          <Avatar user={player} size={36} />
          <span className="arcade-rank-main"><b>{player.name}{player.id === me.id && <small>你</small>}</b><small>总筹码 {num(player.total)} · {player.hands ? `胜率 ${player.winRate}% (${player.wins}/${player.hands})` : '暂无对局'}</small></span>
          <span className="arcade-rank-metric"><strong className={player.net > 0 ? 'positive' : player.net < 0 ? 'negative' : ''}>{signed(player.net)}</strong><small>净赢</small></span>
          <ChevronDown size={16} className="arcade-rank-chevron" />
        </button>
        {expanded && <div className="arcade-stat-card inline"><dl>{statsFor(player).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></div>}
      </div>;
    })}</div>
    : <div className="arcade-ranking-scroll"><table className="arcade-ranking"><thead><tr><th>排名 / 玩家</th><th>总筹码</th><th>净赢</th><th>胜率</th><th>获胜 / 局数</th></tr></thead><tbody>{rows.map(player => <tr key={player.id} className={player.id === me.id ? 'is-me' : ''}><td><button onClick={() => setSelected(player.id)} aria-label={`查看${player.name}的战绩`}><span className={`rank-number rank-${player.rank}`}>{String(player.rank).padStart(2, '0')}</span><Avatar user={player} size={30} /><b>{player.name}{player.id === me.id && <small>你</small>}</b></button></td><td>{num(player.total)}</td><td className={player.net > 0 ? 'positive' : player.net < 0 ? 'negative' : ''}>{signed(player.net)}</td><td>{player.hands ? `${player.winRate}%` : '—'}</td><td>{player.wins} / {player.hands}</td></tr>)}</tbody></table></div>
    : <p className="arcade-panel-empty">正在加载战绩…</p>}
    <p className="arcade-stat-note">{gameTab === 'baccarat' ? '胜率按单局净赢大于 0 的局数统计；和局退本不中断连胜。总筹码为游戏厅通用账户余额与牌桌在局筹码之和。' : '胜率按赢得底池的局数统计，平分计入获胜。总筹码包含账户余额和牌桌筹码；转账与发放不计入净赢。'}</p>
    {!mobile && user && <div className="arcade-stat-card"><header><Avatar user={user} size={36} /><b>{user.name}</b><button onClick={() => setSelected(null)} aria-label="收起战绩"><X size={17} /></button></header><dl>{statsFor(user).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></div>}
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
    try {
      const key = `${mode}:${selected.id}:${value}:${note}`;
      if (submission.current?.key !== key) submission.current = { key, requestId: uid() };
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
        <div className="stake-presets">{(mode === 'mint' ? [[10000, '1万'], [50000, '5万'], [100000, '10万'], [200000, '20万']] : [[1000, '1,000'], [5000, '5,000'], [10000, '1万'], ...(data?.wallet.balance > 0 ? [[data.wallet.balance, '全部']] : [])]).map(([preset, label]) => <button type="button" key={label} className={value === preset ? 'selected' : ''} disabled={mode !== 'mint' && preset > (data?.wallet.balance || 0)} onClick={() => setAmount(String(preset))}>{label}</button>)}</div>
        <label>备注<input aria-label="转账备注" maxLength={80} value={note} onChange={event => setNote(event.target.value)} placeholder="选填" /></label>
      </>}<button className="arcade-primary panel-submit" disabled={!valid || busy}>{busy ? '正在处理…' : review ? `确认${mode === 'mint' ? '发放' : '转账'}` : '下一步'}<ArrowRight size={16} /></button></form>}
  </Sheet>;
}
