import React, { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CircleHelp, Coins, History, LogOut, Minus, Plus, RefreshCw, Send, Trophy, UserPlus, Volume2, VolumeX, X } from 'lucide-react';
import { ArcadeIcon } from '../ArcadeEntry';
import { Avatar } from '../components';
import useArcade from './useArcade';
import useTableMotion from './useTableMotion';
import usePokerAudio from './usePokerAudio';
import ArcadeLobby from './ArcadeLobby';
import { paintChipPile } from './pokerChips';
import { InvitePanel, Leaderboard, StakesPanel, WalletPanel } from './ArcadePanels';
import { DealerArm as DealerDrawing, TableEngraving as TableDrawing, CardOrnament as BackDrawing } from './ArcadeDecor';
import './arcade.css';
import './poker-motion.css';
import './arcade-lobby.css';

const PHASE = { waiting: '等待入座', preflop: '翻牌前', flop: '翻牌', turn: '转牌', river: '河牌', showdown: '本手结算' };
const SUITS = { s: '黑桃', h: '红桃', d: '方块', c: '梅花' };
const number = value => new Intl.NumberFormat('zh-CN').format(value || 0);
const activeHand = table => table && !['waiting', 'showdown'].includes(table.phase);
const DealerArm = memo(DealerDrawing), TableEngraving = memo(TableDrawing), CardOrnament = memo(BackDrawing);

function Suit({ suit = 's', ...props }) {
  const paths = {
    s: 'M12 2C9 6 3 9 3 14a5 5 0 0 0 8 4l-2 4h6l-2-4a5 5 0 0 0 8-4c0-5-6-8-9-12Z',
    h: 'M12 21 3 12C-3 4 8-2 12 6 16-2 27 4 21 12Z',
    d: 'M12 1 22 12 12 23 2 12Z',
    c: 'M10 16a5 5 0 1 1-3-8 5 5 0 1 1 10 0 5 5 0 1 1-3 8l2 6H8Z',
  };
  return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}><path d={paths[suit]} /></svg>;
}

function Counter({ value, digits = 6 }) {
  return <strong className="mechanical-counter" aria-label={number(value)}>{String(value || 0).padStart(digits, ' ').split('').map((digit, i) => <span key={i}><b key={digit}>{digit === ' ' ? '\u00a0' : digit}</b></span>)}</strong>;
}

function CardPips({ rank, suit }) {
  if ('JQK'.includes(rank)) return <svg className="card-portrait" viewBox="0 0 60 94" aria-hidden="true"><rect x="1" y="1" width="58" height="92" fill="#e9dfc4" stroke="currentColor" />{[false, true].map(flip => <g key={String(flip)} transform={flip ? 'rotate(180 30 47)' : undefined}><path d="M10 46 12 33 24 28H36L48 33 50 46Z" fill={suit === 'h' || suit === 'd' ? '#b74738' : '#344b58'} stroke="#524c3b" strokeWidth=".7" /><path d="M24 29 29 46H34L36 29" fill="#c5a34a" /><path d="M16 32 20 46M41 32 39 46" stroke="#e2c46c" strokeWidth="4" /><path d="M23 15Q30 7 37 15L36 25 30 31 24 25Z" fill="#f5e1bb" stroke="#61533d" /><path d="M21 16 23 8 27 11 30 5 33 11 37 8 39 16Z" fill="#bfa04d" stroke="#70603c" /><path d="M26 20h2m5 0h2M28 26h5" fill="none" stroke="#4c4232" strokeWidth="1" /><path d="M9 7V40" stroke="#8b744b" strokeWidth="1.5" /><path d="m6 12 3-7 3 7" fill="#ac9451" />{rank === 'K' && <path d="m25 24 5 7 5-7" fill="none" stroke="#6d533a" strokeWidth="2" />}</g>)}</svg>;
  const layouts = {
    A: [[50, 50]], '2': [[50, 27], [50, 73]], '3': [[50, 24], [50, 50], [50, 76]],
    '4': [[30, 27], [70, 27], [30, 73], [70, 73]],
    '5': [[30, 27], [70, 27], [50, 50], [30, 73], [70, 73]],
    '6': [[30, 24], [70, 24], [30, 50], [70, 50], [30, 76], [70, 76]],
    '7': [[30, 24], [70, 24], [50, 37], [30, 50], [70, 50], [30, 76], [70, 76]],
    '8': [[30, 24], [70, 24], [50, 37], [30, 50], [70, 50], [50, 63], [30, 76], [70, 76]],
    '9': [[30, 20], [70, 20], [30, 40], [70, 40], [50, 50], [30, 60], [70, 60], [30, 80], [70, 80]],
    T: [[30, 20], [70, 20], [50, 30], [30, 40], [70, 40], [30, 60], [70, 60], [50, 70], [30, 80], [70, 80]],
  };
  return <div className={`card-pips ${rank === 'A' ? 'ace' : ''}`}>{(layouts[rank] || []).map(([x, y], i) => <Suit key={i} suit={suit} style={{ left: `${x}%`, top: `${y}%`, transform: `translate(-50%, -50%) ${y > 50 ? 'rotate(180deg)' : ''}` }} />)}</div>;
}

const Card = memo(function Card({ card, back = false, index = 0, boardIndex, small = false, winner = false }) {
  const rank = card?.slice(0, -1), suit = card?.slice(-1);
  const color = suit === 'h' || suit === 'd' ? 'red' : 'black';
  const tilt = event => {
    if (event.pointerType === 'touch') return;
    const box = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty('--rx', `${-(event.clientY - box.top - box.height / 2) / 10}deg`);
    event.currentTarget.style.setProperty('--ry', `${(event.clientX - box.left - box.width / 2) / 8}deg`);
  };
  return <div data-card-index={index} data-board-index={boardIndex} className={`poker-card ${back ? 'back' : color} ${small ? 'small' : ''} ${winner ? 'winning' : ''}`} style={{ '--deal': `${index * 85}ms` }}
    aria-label={back ? '未公开的底牌' : `${SUITS[suit]} ${rank === 'T' ? '10' : rank}`} onPointerMove={tilt} onPointerLeave={event => { event.currentTarget.style.setProperty('--rx', '0deg'); event.currentTarget.style.setProperty('--ry', '0deg'); }}>
    <div className="poker-card-face">{back ? <CardOrnament /> : <>
      <span className="card-corner"><b>{rank === 'T' ? '10' : rank}</b><Suit suit={suit} /></span><CardPips rank={rank} suit={suit} /><span className="card-corner bottom"><b>{rank === 'T' ? '10' : rank}</b><Suit suit={suit} /></span>
    </>}</div>
  </div>;
});

const Chips = memo(function Chips({ amount = 0, unit = 1, className = '' }) {
  const canvas = useRef(null);
  useLayoutEffect(() => { paintChipPile(canvas.current, amount, unit); }, [amount, unit]);
  return <span className={`poker-chips ${className}`} data-chip-amount={amount} data-chip-unit={unit} aria-hidden="true"><canvas ref={canvas} className="poker-chip-pile" /></span>;
});

function Seat({ player, position, table, me, busy, onJoin, now, preview }) {
  if (!player) return <button className={`poker-seat seat-${position} empty-seat`} disabled={busy} onClick={onJoin} aria-label="加入这个牌桌"><span><Plus size={19} /></span><small>空位</small></button>;
  const current = table.turnSeat === player.seat && activeHand(table);
  const mine = player.id === me.id;
  const remaining = Math.max(0, Math.ceil((table.deadline - now) / 1000));
  const status = player.leaving ? '本局后离桌' : player.autoplay ? '托管中' : !activeHand(table) && player.ready ? '已准备' : player.folded ? '已弃牌' : player.allIn ? '全下' : current ? '思考中' : player.lastAction || (activeHand(table) ? player.inHand ? '等待行动' : '本局旁观' : '等待准备');
  const speech = table.messages?.findLast(message => message.userId === player.id && now - message.at < 6500);
  return <div data-seat={player.seat} className={`poker-seat seat-${position} ${current ? 'is-turn' : ''} ${player.folded ? 'is-folded' : ''} ${player.winAmount > 0 ? 'is-winner' : ''} ${mine ? 'is-me' : ''}`}>
    {speech && <div className="seat-speech" key={speech.id} role="status"><b>{player.name}</b><span>{speech.text}</span></div>}
    {player.inHand && <div className="seat-cards" key={table.handId}>{[0, 1].map(index => <Card key={index} card={player.cards?.[index]} back={!player.cards?.[index]} index={index} small={!mine} winner={player.winAmount > 0} />)}</div>}
    <div className="seat-person"><div className="seat-avatar" style={{ '--clock': `${Math.min(100, remaining / (table.turnMs / 1000) * 100)}%` }}><Avatar user={player} size={42} online={player.online} />{current && !player.autoplay && <span className="seat-clock" aria-label={`剩余 ${remaining} 秒`}>{remaining}</span>}</div>
      <div className="seat-identity"><b title={player.name}>{player.name}{mine && <span>你</span>}</b><Counter value={player.stack} /></div>
      {table.buttonSeat === player.seat && <span className="dealer-marker" title="庄家">D</span>}
    </div>
    <span className={`seat-status ${player.allIn ? 'all-in' : ''}`}>{status}{table.smallBlindSeat === player.seat ? ' · 小盲' : table.bigBlindSeat === player.seat ? ' · 大盲' : ''}</span>
    <span data-stack-anchor className={`seat-stack ${preview > 0 ? 'is-selected' : ''}`}><Chips amount={preview > 0 ? preview : 0} unit={table.smallBlind} />{preview > 0 && <b>投入 {number(preview)}</b>}</span>
    <span data-bet-anchor className={`seat-bet ${player.bet > 0 ? '' : 'is-empty'}`} aria-hidden={player.bet <= 0}><Chips amount={player.bet} unit={table.smallBlind} /><b>{number(player.bet)}</b></span>
    {player.winAmount > 0 && <span className="seat-win" key={`${table.handId}-win`}>+{number(player.winAmount)}</span>}
  </div>;
}

function Rules({ onClose }) {
  return <div className="arcade-popover" role="region" aria-label="德州扑克规则"><div><h3>无限注德州扑克</h3><button onClick={onClose} aria-label="收起规则"><X size={18} /></button></div>
    <p>每人 2 张底牌，与 5 张公共牌组成最好的 5 张牌。翻牌前、翻牌、转牌、河牌依次下注。</p>
    <p>每桌底分为小盲注，大盲注为底分的 2 倍；桌主可在开桌或两局之间调整。最小加注幅度等于本轮上一次完整加注；筹码不足可全下，按实际投入分配边池。</p>
    <p>同花顺 ＞ 四条 ＞ 葫芦 ＞ 同花 ＞ 顺子 ＞ 三条 ＞ 两对 ＞ 一对 ＞ 高牌。A 可组成 A2345；花色不分大小，同牌平分。</p>
    <p>首手随机定庄，每手庄家顺时针轮转；两人单挑时庄家兼小盲，翻牌前先行动，翻牌后由大盲先行动。同一场结算后 5 秒自动继续，可在发牌前暂停参与。达到设定手数后结束，再开一场延续庄家轮转。</p>
    <p>每次行动 40 秒；超时进入托管，可过牌时自动过牌，否则弃牌。点击「接回操作」可取消托管。</p>
    <p>每个账号初始 200,000 筹码。牌桌买入从账户扣除，离桌退回剩余筹码；开局后须等本局结束才能离桌。筹码仅供娱乐，不可充值或兑换。</p>
  </div>;
}

function Actions({ table, me, busy, connected, onCommand, wallet, onStakes, onPreview, now }) {
  const [raise, setRaise] = useState(0);
  const own = table.players.find(player => player.id === me.id);
  const actions = table.actions || {};
  const min = actions.minRaiseTo || table.bigBlind;
  const max = actions.maxRaiseTo || 0;
  useEffect(() => { setRaise(Math.min(max, min)); onPreview(null); }, [table.handId, table.phase, table.turnSeat, min, max, onPreview]);
  useEffect(() => { if (!actions.canAct) onPreview(null); }, [actions.canAct, onPreview]);
  const locked = busy || !connected;
  const buyIn = Math.min(table.buyIn, wallet?.balance || 0);
  const act = (action, amount) => onCommand('action', { id: table.id, handId: table.handId, revision: table.revision, action, ...(amount === undefined ? {} : { amount }) });
  const chooseRaise = value => { setRaise(value); onPreview(Number.isSafeInteger(value) && value >= min && value <= max ? { handId: table.handId, seat: own?.seat, amount: Math.max(0, value - (own?.bet || 0)) } : null); };
  if (!own) return <div className="poker-waiting"><span>正在观战 · {table.players.length} / 6 人</span><button className="arcade-primary" disabled={locked || table.players.length >= 6} onClick={() => onCommand('join', { id: table.id })}>加入牌桌<ArrowRight size={16} /></button></div>;
  if (table.matchComplete && !activeHand(table)) return <div className="poker-waiting"><div><strong>本场结束</strong><span>已完成 {table.matchHandNumber} 手 · 筹码已结算</span></div>{table.hostId === me.id ? <div className="waiting-buttons"><button className="arcade-secondary" disabled={locked} onClick={onStakes}>底分 / 手数</button><button className="arcade-primary" disabled={locked} onClick={() => onCommand('newMatch', { id: table.id })}>再开一场<ArrowRight size={16} /></button></div> : <span>等待桌主开启下一场</span>}</div>;
  if (!activeHand(table)) {
    const available = table.players.filter(player => !player.leaving && player.stack > 0);
    const allReady = available.filter(player => player.ready).length >= 2;
    const countdown = table.nextHandAt ? Math.min(5, Math.max(0, Math.ceil((table.nextHandAt - now) / 1000))) : null;
    return <div className="poker-waiting"><div><strong>{countdown !== null ? `${countdown} 秒后自动发下一手` : table.autoContinue ? '等待玩家继续参与' : '牌桌已就绪。'}</strong><span>{table.autoContinue && own.ready ? '本场连续进行，可在发牌前暂停参与或离桌' : available.length < 2 ? '等待至少 2 位玩家入座' : `${available.filter(player => player.ready).length} / ${available.length} 人已准备`}</span></div>
      <div className="waiting-buttons">{table.hostId === me.id && <button className="arcade-secondary" disabled={locked} onClick={onStakes}>底分 / 手数</button>}<button className="arcade-secondary" disabled={locked || buyIn <= 0} onClick={() => onCommand('rebuy', { id: table.id, amount: buyIn })}>买入 {number(buyIn)}</button>{own.stack > 0 && <button className={own.ready ? 'arcade-secondary' : 'arcade-primary'} disabled={locked} onClick={() => onCommand('ready', { id: table.id, ready: !own.ready })}>{own.ready && <Check size={16} />}{table.autoContinue ? own.ready ? '暂停参与' : '继续参与' : own.ready ? '取消准备' : '准备'}</button>}
        {!table.autoContinue && table.hostId === me.id && <button className="arcade-primary start-hand" disabled={locked || !allReady} onClick={() => onCommand('start', { id: table.id })}>开始发牌<ArrowRight size={16} /></button>}</div>
    </div>;
  }
  if (!actions.canAct) return <div className="poker-waiting"><div><strong>{own.leaving ? '本局结束后离桌' : own.folded ? '你已弃牌' : own.allIn ? '你已全下' : !own.inHand ? '下一局加入' : '等待其他玩家行动'}</strong><span>{table.players.find(player => player.seat === table.turnSeat)?.name ? `${table.players.find(player => player.seat === table.turnSeat).name} 正在行动` : '正在结算'}</span></div><div className="waiting-stack">你的筹码<strong>{number(own.stack)}</strong></div></div>;
  const validRaise = Number.isSafeInteger(raise) && raise >= min && raise <= max;
  const preset = ratio => Math.min(max, Math.max(min, own.bet + actions.toCall + Math.floor((table.pot + actions.toCall) * ratio)));
  return <div className="poker-action-panel"><div className="raise-controls"><span>加注至</span><div className="raise-input"><button disabled={locked || !actions.canRaise} aria-label="减少加注" onClick={() => chooseRaise(Math.max(min, raise - table.bigBlind))}><Minus size={15} /></button><input aria-label="加注总额" type="number" inputMode="numeric" min={min} max={max} step="1" value={raise} disabled={locked || !actions.canRaise} onChange={event => chooseRaise(Number(event.target.value))} /><button disabled={locked || !actions.canRaise} aria-label="增加加注" onClick={() => chooseRaise(Math.min(max, raise + table.bigBlind))}><Plus size={15} /></button></div>
      <input className="raise-slider" aria-label="加注滑杆" type="range" min={Math.min(min, max)} max={max} step="1" value={Math.min(max, Math.max(min, raise))} disabled={locked || !actions.canRaise} onChange={event => chooseRaise(Number(event.target.value))} />
      <div className="raise-presets">{[['最小', min], ['半池', preset(.5)], ['满池', preset(1)]].map(([label, value]) => <button key={label} disabled={locked || !actions.canRaise} onClick={() => chooseRaise(value)}>{label}</button>)}</div>
    </div><div className="poker-actions"><button className="action-fold" disabled={locked} onClick={() => act('fold')}>弃牌</button><button className="action-call" disabled={locked} onClick={() => act(actions.canCheck ? 'check' : 'call')}>{actions.canCheck ? '过牌' : <>跟注 <b>{number(actions.toCall)}</b></>}</button><button className="action-raise" disabled={locked || !actions.canRaise || !validRaise} onClick={() => act('raise', raise)}>加注 <b>{number(raise)}</b></button><button className="action-allin" disabled={locked || !actions.canAllIn} onClick={() => act('all-in')}>全下<b>{number(own.stack)}</b></button></div></div>;
}

function TableChat({ table, own, busy, onCommand }) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const list = useRef(null);
  useEffect(() => { if (open) list.current?.scrollTo({ top: list.current.scrollHeight }); }, [table.messages?.length, open]);
  const send = async event => { event.preventDefault(); if (text.trim() && await onCommand('say', { id: table.id, text: text.trim() })) setText(''); };
  return <div className="table-social"><button className="table-chat-toggle" onClick={() => setOpen(value => !value)} aria-expanded={open}>牌桌聊天<span>{table.messages?.length || 0}</span></button>
    <form onSubmit={send}><input aria-label="牌桌聊天消息" maxLength={160} placeholder={own ? '说点什么…' : '入座后可以发言'} value={text} disabled={!own || busy} onChange={event => setText(event.target.value)} /><button type="submit" aria-label="发送牌桌消息" disabled={!own || busy || !text.trim()}><Send size={16} /></button></form>
    {own && <button className={`table-autoplay ${own.autoplay ? 'active' : ''}`} disabled={busy} onClick={() => onCommand('autoplay', { id: table.id, enabled: !own.autoplay })}>{own.autoplay ? '接回操作' : '托管'}</button>}
    {open && <div className="table-chat-history"><header><b>牌桌聊天</b><button aria-label="收起牌桌聊天" onClick={() => setOpen(false)}><X size={16} /></button></header><ol ref={list}>{table.messages?.length ? table.messages.map(message => <li key={message.id}><b>{message.name}</b><p>{message.text}</p><time>{new Date(message.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time></li>) : <li className="empty">还没有消息</li>}</ol></div>}
  </div>;
}

export default function Arcade({ me, connected, onClose, enterTable = false }) {
  const game = useArcade();
  const dialog = useRef(null);
  const stage = useRef(null);
  const [panel, setPanel] = useState('');
  const [wagerPreview, setWagerPreview] = useState(null);
  const [browsing, setBrowsing] = useState(!enterTable);
  const [selectedGame, setSelectedGame] = useState(null);
  useEffect(() => { if (enterTable) setBrowsing(false); }, [enterTable]);
  const [rules, setRules] = useState(false);
  const [history, setHistory] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [now, setNow] = useState(Date.now());
  const offset = useRef(0);
  useEffect(() => { if (game.serverTime) offset.current = game.serverTime - Date.now(); }, [game.serverTime]);
  useEffect(() => {
    const old = document.activeElement;
    dialog.current.showModal();
    const timer = setInterval(() => setNow(Date.now() + offset.current), 250);
    return () => { clearInterval(timer); old?.focus?.(); };
  }, []);
  const table = game.table;
  const showTable = table && !browsing;
  const { enabled: sound, toggle: toggleSound, unlock: unlockSound, play: playSound, stop: stopSound } = usePokerAudio(Boolean(showTable), table?.id);
  useTableMotion(table, stage, Boolean(showTable), playSound, stopSound);
  const own = table?.players.find(player => player.id === me.id);
  useEffect(() => {
    const joined = () => { setBrowsing(false); setPanel(''); };
    window.addEventListener('linliao:arcade-joined', joined);
    return () => window.removeEventListener('linliao:arcade-joined', joined);
  }, []);
  const command = async (action, body) => { const ok = await game.command(action, body); if (ok && ['create', 'join'].includes(action)) setBrowsing(false); if (ok && action === 'leave') { setConfirmLeave(false); setBrowsing(!game.table?.players.some(player => player.id === me.id && player.inHand)); } return ok; };
  const view = async id => { await game.inspect(id); setBrowsing(false); };
  const mySeat = own?.seat ?? 0;
  const winners = table?.result?.winners || [];
  const back = () => { if (showTable) { setBrowsing(true); setSelectedGame('poker'); } else if (selectedGame) setSelectedGame(null); else onClose(); };
  const nativeMac = window.desktop?.platform === 'macos';
  return <dialog ref={dialog} className={`arcade-dialog ${nativeMac ? 'is-mac' : ''}`} aria-labelledby="arcade-title" onPointerDownCapture={unlockSound} onKeyDownCapture={unlockSound} onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }}>
    <div className="arcade-app">{nativeMac && <div className="arcade-window-chrome" data-drag-region aria-hidden="true" />}<header className="arcade-header"><button className="arcade-back" onClick={back} aria-label={showTable ? '返回德州大厅' : selectedGame ? '返回游戏列表' : '返回聊天'}><ArrowLeft size={19} /></button><div className="arcade-wordmark"><ArcadeIcon size={25} /><h1 id="arcade-title">游戏厅</h1><span>/</span><b>{showTable ? table.name : selectedGame ? '德州扑克' : '全部游戏'}</b></div><span className={`arcade-network ${connected ? '' : 'offline'}`}><i />{connected ? '在线' : '重连中'}</span><button className="arcade-close" onClick={onClose}><span>返回聊天</span><X size={18} /></button></header>
      {game.error && <div className="arcade-error" role="alert"><span>{game.error}</span><button onClick={game.refresh} aria-label="重新连接游戏厅"><RefreshCw size={16} /></button></div>}
      {!connected && <div className="arcade-disconnected" role="status">正在重新连接，行动暂不可用；恢复后自动同步牌局。</div>}
      {game.loading && !game.tables ? <div className="arcade-loading" role="status"><RefreshCw size={25} className="spin" /><p>正在连接游戏厅…</p></div> : !showTable ? <ArcadeLobby game={game} me={me} connected={connected} table={table} own={own} selectedGame={selectedGame} onSelect={setSelectedGame} onView={view} onReturn={() => setBrowsing(false)} onCommand={command} onPanel={setPanel} onRules={() => setRules(true)} roomIcon={<Suit suit="s" />} art={<><div className="feature-orbit" /><div className="hero-card card-one"><Card card="As" /></div><div className="hero-card card-two"><Card card="Ah" /></div><div className="hero-chip-stack"><Chips amount={500} /></div></>} /> : <main className="poker-room"><div className="poker-room-top"><div><span className="poker-live-dot" /><b>德州扑克</b><span>盲注 {table.smallBlind} / {table.bigBlind}</span><span>第 {table.matchNumber} 场 · {table.matchHandNumber}{table.handLimit ? ` / ${table.handLimit}` : ''} 手{!table.handLimit && ' · 不限'}</span></div><div className="poker-tools"><button onClick={() => setPanel('rank')} aria-label="排行榜"><Trophy size={17} /></button><button onClick={() => setPanel('wallet')} aria-label="我的筹码"><Coins size={17} /></button>{own && <button onClick={() => setPanel('invite')} aria-label="邀请好友进房"><UserPlus size={17} /></button>}<button onClick={toggleSound} aria-label={sound ? '关闭游戏声音' : '开启游戏声音'} aria-pressed={sound}>{sound ? <Volume2 size={17} /> : <VolumeX size={17} />}</button><button onClick={() => setHistory(value => !value)} aria-label="本局记录" aria-pressed={history}><History size={17} /></button><button onClick={() => setRules(value => !value)} aria-label="玩法规则" aria-pressed={rules}><CircleHelp size={17} /></button>{own && <button className="leave-table" disabled={activeHand(table)} title={activeHand(table) ? '本局结束后可以离桌' : '离桌并退回筹码'} onClick={() => setConfirmLeave(true)}><LogOut size={16} /><span>离桌</span></button>}</div></div>
        <div className="poker-layout"><section ref={stage} className={`poker-stage ${table.phase === 'showdown' ? 'settled' : ''}`} aria-label="德州扑克牌桌"><div className="poker-ambient" /><div className="poker-felt"><TableEngraving /><div className="felt-stitch" /><div className="poker-scoreboard"><div><span>盲注 {table.smallBlind} / {table.bigBlind}</span><b>{table.matchComplete ? '本场结束' : PHASE[table.phase]}</b></div><div><span>底池总额</span><Counter value={table.pot} /><i className="street-lights">{[0, 1, 2, 3].map(i => <em key={i} className={['preflop', 'flop', 'turn', 'river', 'showdown'].indexOf(table.phase) >= i ? 'on' : ''} />)}</i></div></div><DealerArm phase={table.phase} handId={table.handId} /><div className="felt-label">虾扯蛋 <span>POKER CLUB</span></div><div className="board-area"><span className="street-label">{PHASE[table.phase]}</span><div className="pot-rack" data-pot-anchor><Chips unit={table.smallBlind} amount={table.phase === 'showdown' ? 0 : Math.max(0, table.pot - table.players.reduce((sum, player) => sum + player.bet, 0))} /></div><div className="poker-pot" key={`${table.handId}-${table.pot}`}><span>底池</span><strong>{number(table.pot)}</strong></div><div className="community-cards">{Array.from({ length: 5 }, (_, i) => table.board[i] ? <Card key={`${table.handId}-${i}`} card={table.board[i]} index={i} boardIndex={i} /> : <div className="card-placeholder" key={`empty-${i}`}><Suit suit={i % 2 ? 'h' : 's'} /></div>)}</div>{table.phase === 'waiting' && <p className="board-hint">入座，准备，开始一局。</p>}{table.phase === 'showdown' && winners.length > 0 && <div className="poker-result" role="status" key={table.handId}><strong>{winners.map(winner => table.players.find(player => player.id === winner.id)?.name || '玩家').join('、')} {winners.length > 1 ? '分享底池' : '赢得底池'}</strong><span>{table.result.reason === 'fold' ? '其他玩家弃牌' : [...new Set(winners.map(winner => winner.hand).filter(Boolean))].join(' · ')}</span></div>}</div></div>
          <div className="poker-deck" data-deal-origin aria-hidden="true"><Card back small /><Card back small /></div>
          {Array.from({ length: 6 }, (_, position) => { const seat = (position + mySeat) % 6; return <Seat key={seat} position={position} player={table.players.find(player => player.seat === seat)} table={table} me={me} busy={game.busy || Boolean(own) || !connected} onJoin={() => command('join', { id: table.id, seat })} now={now} preview={wagerPreview?.handId === table.handId && wagerPreview?.seat === seat && table.actions?.canAct ? wagerPreview.amount : 0} />; })}
          <div className="table-motion-layer" aria-hidden="true" /><span className="table-id">{table.id.slice(0, 8).toUpperCase()}</span>
        </section><aside className={`poker-ledger ${history ? 'show-ledger' : ''}`}><div className="ledger-heading"><h3>本局记录</h3><button className="mobile-ledger-close" onClick={() => setHistory(false)} aria-label="收起记录"><X size={17} /></button></div><div className="ledger-pot"><span>底池总额</span><strong>{number(table.pot)}</strong><small>{table.players.filter(player => player.inHand && !player.folded).length} 人仍在本局</small></div><ol>{[...(table.log || [])].reverse().slice(0, 20).map(entry => <li key={entry.id}><span>{entry.text}</span><time>{new Date(entry.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time></li>)}</ol>{table.result?.pots?.length > 1 && <div className="side-pots">{table.result.pots.map((pot, index) => <div key={index}><span>{index ? `边池 ${index}` : '主池'}</span><b>{number(pot.amount)}</b></div>)}</div>}<div className="ledger-footer">2–6 人 · 虚拟筹码</div></aside></div>
        <TableChat table={table} own={own} busy={game.busy || !connected} onCommand={command} /><Actions table={table} me={me} busy={game.busy} connected={connected} onCommand={command} wallet={game.wallet} onStakes={() => setPanel('stakes')} onPreview={setWagerPreview} now={now} />
      </main>}
      {panel === 'stakes' && table && <StakesPanel table={table} onCommand={command} error={game.error} onClose={() => setPanel('')} />}{panel === 'rank' && <Leaderboard me={me} onClose={() => setPanel('')} />}{panel === 'wallet' && <WalletPanel me={me} onClose={() => setPanel('')} onChanged={game.refresh} />}{panel === 'invite' && table && <InvitePanel table={table} error={game.error} onCommand={command} onClose={() => setPanel('')} />}{rules && <Rules onClose={() => setRules(false)} />}
      {confirmLeave && <div className="arcade-confirm"><div role="alertdialog" aria-modal="true" aria-labelledby="leave-title"><h3 id="leave-title">离开牌桌？</h3><p>{activeHand(table) && own?.inHand ? own.allIn ? '你已全下，本局会继续结算，结束后可换桌。' : '之后自动过牌或弃牌，本局结束后可换桌。已投入的筹码留在底池。' : `离桌后，剩余 ${number(own?.stack)} 筹码会退回账户。`}</p><div><button className="arcade-secondary" onClick={() => setConfirmLeave(false)}>继续玩</button><button className="arcade-primary" disabled={game.busy} onClick={() => command('leave', { id: table.id })}>确认离桌</button></div></div></div>}
    </div>
  </dialog>;
}
