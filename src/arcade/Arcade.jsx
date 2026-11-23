import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Bot, Check, CircleHelp, Coins, Copy, Eye, EyeOff, Hand, History, Lock, LogOut, MessageSquare, Minus, MoreHorizontal, Plus, RefreshCw, Send, SlidersHorizontal, Trophy, UserPlus, Volume2, VolumeX, X, Zap } from 'lucide-react';
import { ArcadeIcon } from '../ArcadeEntry';
import { Avatar } from '../components';
import { haptic } from '../chatPrefs';
import { copyText } from '../mobile/runtime';
import { useIsMobile } from '../mobile/ui';
import useArcade from './useArcade';
import useBaccarat from './useBaccarat';
import useTableMotion from './useTableMotion';
import usePokerAudio from './usePokerAudio';
import ArcadeLobby from './ArcadeLobby';
import BaccaratRoom, { BaccaratRules } from './BaccaratRoom';
import { Card, Chips, Counter, Suit } from './ArcadeCards';
import { InvitePanel, Leaderboard, Sheet, StakesPanel, WalletPanel } from './ArcadePanels';
import { DealerArm as DealerDrawing, TableEngraving as TableDrawing } from './ArcadeDecor';
import './arcade.css';
import './poker-motion.css';
import './arcade-lobby.css';
import './baccarat.css';

const PHASE = { waiting: '等待入座', preflop: '翻牌前', flop: '翻牌', turn: '转牌', river: '河牌', showdown: '本手结算' };
const PRIVACY_KEY = 'linliao.arcade.privacy';
const number = value => new Intl.NumberFormat('zh-CN').format(value || 0);
const activeHand = table => table && !['waiting', 'showdown'].includes(table.phase);
const DealerArm = memo(DealerDrawing), TableEngraving = memo(TableDrawing);

function Seat({ player, position, table, me, busy, onJoin, now, preview, coveredCards, peekingCards, onToggleCover, onPeekChange }) {
  if (!player) return <button className={`poker-seat seat-${position} empty-seat`} disabled={busy} onClick={onJoin} aria-label="加入这个牌桌"><span><Plus size={19} /></span><small>空位</small></button>;
  const current = table.turnSeat === player.seat && activeHand(table);
  const mine = player.id === me.id;
  const remaining = Math.max(0, Math.ceil((table.deadline - now) / 1000));
  const urgent = current && !player.autoplay && remaining <= 8;
  const status = player.leaving ? '已离桌' : player.leaveAfterHand ? '本局后离桌' : player.autoplay ? '托管中' : !activeHand(table) && player.ready ? '已准备' : player.folded ? '已弃牌' : player.allIn ? '全下' : current ? '思考中' : player.lastAction || (activeHand(table) ? player.inHand ? '等待行动' : player.ready ? '下局加入' : '已暂停' : '等待准备');
  const statusTone = player.allIn ? 'all-in' : player.folded ? 'is-folded-tag' : current ? 'is-turn-tag' : (!activeHand(table) || !player.inHand) && player.ready && !player.leaving && !player.leaveAfterHand ? 'is-ready-tag' : '';
  const blindTag = table.smallBlindSeat === player.seat ? '小盲' : table.bigBlindSeat === player.seat ? '大盲' : '';
  const speech = table.messages?.findLast(message => message.userId === player.id && now - message.at < 6500);
  const showdownReveal = table.phase === 'showdown' && !player.folded;
  const anyCovered = mine && player.inHand && !showdownReveal && Boolean(coveredCards?.[0] || coveredCards?.[1]) && !peekingCards?.[0] && !peekingCards?.[1];
  return <div data-seat={player.seat} className={`poker-seat seat-${position} ${player.inHand ? 'has-cards' : ''} ${current ? 'is-turn' : ''} ${player.folded ? 'is-folded' : ''} ${player.allIn ? 'is-allin' : ''} ${player.winAmount > 0 ? 'is-winner' : ''} ${mine ? 'is-me' : ''}`}>
    {speech && <div className="seat-speech" key={speech.id} role="status"><b>{player.name}</b><span>{speech.text}</span></div>}
    {player.inHand && <div className="seat-cards" key={table.handId}>{[0, 1].map(index => {
      const cardCode = player.cards?.[index];
      const coverable = mine && Boolean(cardCode) && !showdownReveal;
      const covered = coverable && Boolean(coveredCards?.[index]);
      const peeking = coverable && covered && Boolean(peekingCards?.[index]);
      const showBack = !cardCode || (covered && !peeking);
      return <Card key={index} card={cardCode} back={showBack} index={index} small={!mine} winner={player.winAmount > 0 && !showBack}
        coverable={coverable} covered={covered} peeking={peeking}
        onToggleCover={coverable ? onToggleCover : undefined} onPeekChange={coverable ? onPeekChange : undefined} />;
    })}{anyCovered && <span className="seat-peek-hint" aria-hidden="true">长按偷看</span>}</div>}
    <div className="seat-person"><div className="seat-avatar" data-urgent={urgent ? 'true' : undefined} style={{ '--clock': `${Math.min(100, remaining / (table.turnMs / 1000) * 100)}%` }}><Avatar user={player} size={42} online={player.online} />{current && !player.autoplay && <span className="seat-clock" aria-label={`剩余 ${remaining} 秒`}>{remaining}</span>}</div>
      <div className="seat-identity"><b title={player.name}>{player.name}{mine && <span>你</span>}</b><Counter value={player.stack} /></div>
      {table.buttonSeat === player.seat && <span className="dealer-marker" title="庄家">D</span>}
    </div>
    <span className={`seat-status ${statusTone}`}>{status}{blindTag && !status.startsWith(blindTag) ? ` · ${blindTag}` : ''}</span>
    <span data-stack-anchor className={`seat-stack ${preview > 0 ? 'is-selected' : ''}`}><Chips amount={preview > 0 ? preview : 0} unit={table.smallBlind} />{preview > 0 && <b>投入 {number(preview)}</b>}</span>
    <span data-bet-anchor className={`seat-bet ${player.bet > 0 ? '' : 'is-empty'}`} aria-hidden={player.bet <= 0}><Chips amount={player.bet} unit={table.smallBlind} /><b>{number(player.bet)}</b></span>
    {player.winAmount > 0 && <span className="seat-win" key={`${table.handId}-win`}>+{number(player.winAmount)}</span>}
  </div>;
}

const QUICK_PHRASES = ['好牌', '我想想', '快点出牌', '稳住', '厉害了', '下局再来'];

function Rules({ onClose, mobile = false }) {
  const paragraphs = <>
    <p>每人 2 张底牌，与 5 张公共牌组成最好的 5 张牌。翻牌前、翻牌、转牌、河牌依次下注。</p>
    <p>每桌底分为小盲注，大盲注为底分的 2 倍；开桌时可选择公开或私密，私密牌桌不在大厅展示，可通过牌桌内邀请好友或 6 位房间口令进入。桌主可在两局之间调整底分、手数与公开/私密状态。</p>
    <p>最小加注幅度等于本轮上一次完整加注；筹码不足可全下，按实际投入分配边池。同花顺 ＞ 四条 ＞ 葫芦 ＞ 同花 ＞ 顺子 ＞ 三条 ＞ 两对 ＞ 一对 ＞ 高牌。A 可组成 A2345；花色不分大小，同牌平分。</p>
    <p>首手随机定庄，每手庄家顺时针轮转；两人单挑时庄家兼小盲，翻牌前先行动，翻牌后由大盲先行动。同一场结算后 5 秒自动继续，中途入座默认下一手自动加入，可随时暂停参与。达到设定手数后结束，再开一场延续庄家轮转。</p>
    <p>每次行动 40 秒；超时进入托管，可过牌时自动过牌，否则弃牌；本手结束后托管会自动暂停下局参与，回到牌桌点击「继续参与」即可恢复。</p>
    <p>每个账号初始 200,000 筹码。牌桌买入从账户扣除，离桌退回剩余筹码；未参与本手可随时离桌或换桌，局中可预约本局后离桌或立即离桌（本手结算后自动退回筹码）。筹码仅供娱乐，不可充值或兑换。</p>
    <p>点击自己的任意一张底牌可单独盖牌防窥；盖牌时长按可临时偷看、松手自动扣回，也可在顶栏开启防窥模式。</p>
  </>;
  if (mobile) return <Sheet title="无限注德州扑克规则" icon={<CircleHelp size={20} />} onClose={onClose}><div className="arcade-rules-body">{paragraphs}</div></Sheet>;
  return <div className="arcade-popover" role="region" aria-label="德州扑克规则"><div><h3>无限注德州扑克</h3><button onClick={onClose} aria-label="收起规则"><X size={18} /></button></div>
    {paragraphs}
  </div>;
}

function Actions({ table, me, busy, connected, onCommand, wallet, onStakes, onPreview, now, mobile = false, raiseOpen = false, setRaiseOpen }) {
  const [raise, setRaise] = useState(0);
  const [confirmAllIn, setConfirmAllIn] = useState(false);
  const prevCanAct = useRef(false);
  const allInTimer = useRef(0);
  const seatedSelf = table.players.find(player => player.id === me.id);
  const own = seatedSelf && !seatedSelf.leaving ? seatedSelf : null;
  const actions = table.actions || {};
  const min = actions.minRaiseTo || table.bigBlind;
  const max = actions.maxRaiseTo || 0;
  useEffect(() => { setRaise(Math.min(max, min)); setConfirmAllIn(false); setRaiseOpen?.(false); onPreview(null); }, [table.handId, table.phase, table.turnSeat, min, max, onPreview, setRaiseOpen]);
  useEffect(() => {
    if (!actions.canAct) { onPreview(null); setRaiseOpen?.(false); setConfirmAllIn(false); }
    else if (mobile && !prevCanAct.current) haptic();
    prevCanAct.current = Boolean(actions.canAct);
  }, [actions.canAct, onPreview, mobile, setRaiseOpen]);
  useEffect(() => {
    clearTimeout(allInTimer.current);
    if (!confirmAllIn) return;
    allInTimer.current = setTimeout(() => setConfirmAllIn(false), 3000);
    return () => clearTimeout(allInTimer.current);
  }, [confirmAllIn]);
  useEffect(() => { setConfirmAllIn(false); }, [raiseOpen, raise]);
  const locked = busy || !connected;
  const buyIn = Math.min(table.buyIn, wallet?.balance || 0);
  const act = (action, amount) => onCommand('action', { id: table.id, handId: table.handId, revision: table.revision, action, ...(amount === undefined ? {} : { amount }) });
  const chooseRaise = value => { setRaise(value); onPreview(Number.isSafeInteger(value) && value >= min && value <= max ? { handId: table.handId, seat: own?.seat, amount: Math.max(0, value - (own?.bet || 0)) } : null); };
  const snapRaise = raw => {
    if (raw <= min) return min;
    if (raw >= max) return max;
    const step = Math.max(1, table.bigBlind || 1);
    return Math.min(max, Math.max(min, min + Math.round((raw - min) / step) * step));
  };
  const tryAllIn = () => {
    if (!mobile) { act('all-in'); return; }
    if (!confirmAllIn) { setConfirmAllIn(true); haptic(); return; }
    setConfirmAllIn(false);
    setRaiseOpen?.(false);
    act('all-in');
  };
  if (seatedSelf?.leaving) return <div className="poker-waiting"><div><strong>已离桌，等待本手结算</strong><span>本手结束后剩余筹码会自动退回账户，之后可重新入座或换桌</span></div><div className="waiting-stack">本桌筹码<strong>{number(seatedSelf.stack)}</strong></div></div>;
  if (!own) return <div className="poker-waiting"><span>正在观战 · {table.players.filter(player => !player.leaving).length} / 6 人</span><button className="arcade-primary" disabled={locked || table.players.length >= 6} onClick={() => onCommand('join', { id: table.id })}>加入牌桌<ArrowRight size={16} /></button></div>;
  if (table.matchComplete && !activeHand(table)) return <div className="poker-waiting"><div><strong>本场结束</strong><span>已完成 {table.matchHandNumber} 手 · 筹码已结算</span></div>{table.hostId === me.id ? <div className="waiting-buttons"><button className="arcade-secondary" disabled={locked} onClick={onStakes}>牌桌设置</button><button className="arcade-primary" disabled={locked} onClick={() => onCommand('newMatch', { id: table.id })}>再开一场<ArrowRight size={16} /></button></div> : <span>等待桌主开启下一场</span>}</div>;
  if (!activeHand(table)) {
    const available = table.players.filter(player => !player.leaving && !player.leaveAfterHand && player.stack > 0);
    const allReady = available.filter(player => player.ready).length >= 2;
    const countdown = table.nextHandAt ? Math.min(5, Math.max(0, Math.ceil((table.nextHandAt - now) / 1000))) : null;
    return <div className={`poker-waiting ${countdown !== null ? 'is-countdown' : ''}`}><div><strong>{countdown !== null ? `${countdown} 秒后自动发下一手` : table.autoContinue ? '等待玩家继续参与' : '牌桌已就绪。'}</strong><span>{table.autoContinue && own.ready ? '本场连续进行，可在发牌前暂停参与或离桌' : available.length < 2 ? '等待至少 2 位玩家入座' : `${available.filter(player => player.ready).length} / ${available.length} 人已准备`}</span></div>
      <div className="waiting-buttons">{table.hostId === me.id && <button className="arcade-secondary" disabled={locked} onClick={onStakes}>牌桌设置</button>}<button className="arcade-secondary" disabled={locked || buyIn <= 0} onClick={() => onCommand('rebuy', { id: table.id, amount: buyIn })}>买入 {number(buyIn)}</button>{own.stack > 0 && <button className={own.ready ? 'arcade-secondary' : 'arcade-primary'} disabled={locked} onClick={() => onCommand('ready', { id: table.id, ready: !own.ready })}>{own.ready && <Check size={16} />}{table.autoContinue ? own.ready ? '暂停参与' : '继续参与' : own.ready ? '取消准备' : '准备'}</button>}
        {!table.autoContinue && table.hostId === me.id && <button className="arcade-primary start-hand" disabled={locked || !allReady} onClick={() => onCommand('start', { id: table.id })}>开始发牌<ArrowRight size={16} /></button>}</div>
    </div>;
  }
  const turnName = table.players.find(player => player.seat === table.turnSeat)?.name;
  const turnText = turnName ? `${turnName} 正在行动` : '正在结算';
  if (!own.inHand) return <div className="poker-waiting"><div><strong>{own.stack <= 0 ? '筹码不足，补充后可加入下一手' : own.ready ? '下一手自动加入' : '已暂停参与'}</strong><span>{turnText} · 你的筹码 {number(own.stack)}</span></div><div className="waiting-buttons">{buyIn > 0 && <button className="arcade-secondary" disabled={locked} onClick={() => onCommand('rebuy', { id: table.id, amount: buyIn })}>买入 {number(buyIn)}</button>}{own.stack > 0 && <button className={own.ready ? 'arcade-secondary' : 'arcade-primary'} disabled={locked} onClick={() => onCommand('ready', { id: table.id, ready: !own.ready })}>{own.ready ? '暂停下局' : '加入下局'}</button>}</div></div>;
  if (!actions.canAct) return <div className="poker-waiting"><div><strong>{own.leaveAfterHand ? '本手结束后自动离桌' : own.folded ? '你已弃牌' : own.allIn ? '你已全下' : '等待其他玩家行动'}</strong><span>{turnText}{!own.leaveAfterHand && !own.ready ? ' · 下局已暂停' : ''}</span></div>{own.leaveAfterHand ? <div className="waiting-buttons"><button className="arcade-secondary" disabled={locked} onClick={() => onCommand('leave', { id: table.id, mode: 'cancel' })}>取消离桌</button></div> : own.folded && own.stack > 0 ? <div className="waiting-buttons"><button className="arcade-secondary" disabled={locked} onClick={() => onCommand('ready', { id: table.id, ready: !own.ready })}>{own.ready ? '暂停下局' : '继续下局'}</button><div className="waiting-stack">你的筹码<strong>{number(own.stack)}</strong></div></div> : <div className="waiting-stack">你的筹码<strong>{number(own.stack)}</strong></div>}</div>;
  const validRaise = Number.isSafeInteger(raise) && raise >= min && raise <= max;
  const preset = ratio => Math.min(max, Math.max(min, own.bet + actions.toCall + Math.floor((table.pot + actions.toCall) * ratio)));
  const clampedRaise = Math.min(max, Math.max(min, raise));
  const raisePct = max > min ? Math.max(0, Math.min(100, ((clampedRaise - min) / (max - min)) * 100)) : 100;
  if (mobile) {
    const isAllInRaise = clampedRaise >= max && actions.canAllIn;
    const extraPut = Math.max(0, clampedRaise - (own?.bet || 0));
    return <div className="poker-action-panel mobile-cockpit">
      {raiseOpen && actions.canRaise && <>
        <div className="poker-raise-backdrop" onClick={() => { setRaiseOpen?.(false); onPreview(null); }} />
        <div className="poker-raise-drawer" role="region" aria-label="选择加注金额">
          <div className="raise-drawer-head">
            <div className="raise-drawer-amount">
              <span>加注至</span>
              <strong>{number(clampedRaise)}</strong>
              <small>{isAllInRaise ? '全下' : `投入 +${number(extraPut)}`}</small>
            </div>
            <button type="button" className="raise-drawer-close" aria-label="收起加注" onClick={() => { setRaiseOpen?.(false); onPreview(null); }}><X size={18} /></button>
          </div>
          <div className="raise-presets mobile-raise-presets">
            {[['最小', min], ['1/2池', preset(.5)], ['3/4池', preset(.75)], ['满池', preset(1)], ['全下', max]].map(([label, value]) =>
              <button type="button" key={label} className={clampedRaise === value ? 'is-active' : ''} disabled={locked} onClick={() => chooseRaise(value)}>{label}</button>)}
          </div>
          <div className="raise-slider-row">
            <button type="button" className="raise-step-btn" disabled={locked || clampedRaise <= min} aria-label="减少加注" onClick={() => chooseRaise(Math.max(min, clampedRaise - table.bigBlind))}><Minus size={18} /></button>
            <input className="raise-slider" aria-label="加注滑杆" type="range" min={Math.min(min, max)} max={max} step="1" value={clampedRaise} style={{ '--raise-pct': `${raisePct}%` }} disabled={locked} onChange={event => chooseRaise(snapRaise(Number(event.target.value)))} />
            <button type="button" className="raise-step-btn" disabled={locked || clampedRaise >= max} aria-label="增加加注" onClick={() => chooseRaise(Math.min(max, clampedRaise + table.bigBlind))}><Plus size={18} /></button>
          </div>
          {isAllInRaise
            ? <button type="button" className={`action-allin poker-raise-confirm ${confirmAllIn ? 'is-armed' : ''}`} disabled={locked} onClick={tryAllIn}>{confirmAllIn ? `再点确认全下 ${number(own.stack)}` : `全下 ${number(own.stack)}`}</button>
            : <button type="button" className="action-raise poker-raise-confirm" disabled={locked || !validRaise} onClick={() => { setRaiseOpen?.(false); act('raise', clampedRaise); }}>确认加注至 <b>{number(clampedRaise)}</b></button>}
        </div>
      </>}
      <div className="poker-actions mobile-three">
        <button type="button" className="action-fold" disabled={locked} onClick={() => { setRaiseOpen?.(false); act('fold'); }}>弃牌</button>
        <button type="button" className="action-call" disabled={locked} onClick={() => { setRaiseOpen?.(false); act(actions.canCheck ? 'check' : 'call'); }}>{actions.canCheck ? '过牌' : <><span>跟注</span><b>{number(actions.toCall)}</b></>}</button>
        {actions.canRaise
          ? <button type="button" className={`action-raise ${raiseOpen ? 'is-open' : ''}`} disabled={locked} aria-expanded={raiseOpen} onClick={() => { const next = !raiseOpen; setRaiseOpen?.(next); if (next) chooseRaise(clampedRaise); else onPreview(null); }}>{raiseOpen ? '收起' : <><span>加注</span><b>{number(min)}+</b></>}</button>
          : <button type="button" className={`action-allin ${confirmAllIn ? 'is-armed' : ''}`} disabled={locked || !actions.canAllIn} onClick={tryAllIn}>{confirmAllIn ? '确认全下' : <><span>全下</span><b>{number(own.stack)}</b></>}</button>}
      </div>
    </div>;
  }
  return <div className="poker-action-panel"><div className="raise-controls"><span>加注至</span><div className="raise-input"><button disabled={locked || !actions.canRaise} aria-label="减少加注" onClick={() => chooseRaise(Math.max(min, raise - table.bigBlind))}><Minus size={15} /></button><input aria-label="加注总额" type="number" inputMode="numeric" min={min} max={max} step="1" value={raise} disabled={locked || !actions.canRaise} onChange={event => chooseRaise(Number(event.target.value))} /><button disabled={locked || !actions.canRaise} aria-label="增加加注" onClick={() => chooseRaise(Math.min(max, raise + table.bigBlind))}><Plus size={15} /></button></div>
      <input className="raise-slider" aria-label="加注滑杆" type="range" min={Math.min(min, max)} max={max} step="1" value={clampedRaise} style={{ '--raise-pct': `${raisePct}%` }} disabled={locked || !actions.canRaise} onChange={event => chooseRaise(Number(event.target.value))} />
      <div className="raise-presets">{[['最小', min], ['半池', preset(.5)], ['满池', preset(1)]].map(([label, value]) => <button key={label} className={raise === value ? 'is-active' : ''} disabled={locked || !actions.canRaise} onClick={() => chooseRaise(value)}>{label}</button>)}</div>
    </div><div className="poker-actions"><button className="action-fold" disabled={locked} onClick={() => act('fold')}>弃牌</button><button className="action-call" disabled={locked} onClick={() => act(actions.canCheck ? 'check' : 'call')}>{actions.canCheck ? '过牌' : <>跟注 <b>{number(actions.toCall)}</b></>}</button><button className="action-raise" disabled={locked || !actions.canRaise || !validRaise} onClick={() => act('raise', raise)}>加注 <b>{number(raise)}</b></button><button className="action-allin" disabled={locked || !actions.canAllIn} onClick={() => act('all-in')}>全下<b>{number(own.stack)}</b></button></div></div>;
}

function TableChat({ table, own, busy, onCommand, mobile = false, mobileOpen = false, onMobileClose }) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const list = useRef(null);
  const activeOpen = mobile ? mobileOpen : open;
  useEffect(() => { if (activeOpen) list.current?.scrollTo({ top: list.current.scrollHeight }); }, [table.messages?.length, activeOpen]);
  const sendText = async content => {
    const trimmed = content.trim();
    if (!trimmed || !own || busy) return;
    if (await onCommand('say', { id: table.id, text: trimmed })) setText('');
  };
  const send = async event => { event.preventDefault(); await sendText(text); };
  if (mobile) {
    if (!mobileOpen) return null;
    return <Sheet title="牌桌聊天" icon={<MessageSquare size={20} />} onClose={onMobileClose}>
      <div className="mobile-poker-chat">
        <ol className="mobile-poker-chat-list" ref={list}>
          {table.messages?.length ? table.messages.map(message => <li key={message.id}><b>{message.name}</b><p>{message.text}</p><time>{new Date(message.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time></li>) : <li className="empty">还没有牌桌消息</li>}
        </ol>
        {own && <div className="poker-quick-phrases" role="group" aria-label="快捷短语">
          {QUICK_PHRASES.map(phrase => <button key={phrase} type="button" disabled={busy} onClick={() => sendText(phrase)}>{phrase}</button>)}
        </div>}
        <form className="mobile-poker-chat-form" onSubmit={send}>
          <input aria-label="牌桌聊天消息" maxLength={160} placeholder={own ? '说点什么…' : '入座后可以发言'} value={text} disabled={!own || busy} onChange={event => setText(event.target.value)} />
          <button type="submit" aria-label="发送牌桌消息" disabled={!own || busy || !text.trim()}><Send size={17} /></button>
        </form>
      </div>
    </Sheet>;
  }
  return <div className="table-social"><button className="table-chat-toggle" onClick={() => setOpen(value => !value)} aria-expanded={open}>牌桌聊天<span>{table.messages?.length || 0}</span></button>
    <form onSubmit={send}><input aria-label="牌桌聊天消息" maxLength={160} placeholder={own ? '说点什么…' : '入座后可以发言'} value={text} disabled={!own || busy} onChange={event => setText(event.target.value)} /><button type="submit" aria-label="发送牌桌消息" disabled={!own || busy || !text.trim()}><Send size={16} /></button></form>
    {own && <button className={`table-autoplay ${own.autoplay ? 'active' : ''}`} disabled={busy} onClick={() => onCommand('autoplay', { id: table.id, enabled: !own.autoplay })}>{own.autoplay ? '接回操作' : '托管'}</button>}
    {open && <div className="table-chat-history"><header><b>牌桌聊天</b><button aria-label="收起牌桌聊天" onClick={() => setOpen(false)}><X size={16} /></button></header><ol ref={list}>{table.messages?.length ? table.messages.map(message => <li key={message.id}><b>{message.name}</b><p>{message.text}</p><time>{new Date(message.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time></li>) : <li className="empty">还没有消息</li>}</ol></div>}
  </div>;
}

export default function Arcade({ me, connected, onClose, enterTable = false }) {
  const game = useArcade();
  const mobile = useIsMobile();
  const dialog = useRef(null);
  const stage = useRef(null);
  const [panel, setPanel] = useState('');
  const [wagerPreview, setWagerPreview] = useState(null);
  const [browsing, setBrowsing] = useState(!enterTable);
  const [selectedGame, setSelectedGame] = useState(null);
  const [creatingTable, setCreatingTable] = useState(false);
  const [joiningTable, setJoiningTable] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const copyCodeTimer = useRef(0);
  const baccarat = useBaccarat(selectedGame === 'baccarat');
  useEffect(() => { if (enterTable) setBrowsing(false); }, [enterTable]);
  const [rules, setRules] = useState(false);
  const [history, setHistory] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [tableChatOpen, setTableChatOpen] = useState(false);
  const [tableMenuOpen, setTableMenuOpen] = useState(false);
  const [raiseOpen, setRaiseOpen] = useState(false);
  const [chatSeenCount, setChatSeenCount] = useState(0);
  const [privacyMode, setPrivacyMode] = useState(() => {
    try { return localStorage.getItem(PRIVACY_KEY) === 'on'; } catch { return false; }
  });
  const [coverState, setCoverState] = useState({ handKey: '', flags: [false, false] });
  const [peekState, setPeekState] = useState({ handKey: '', flags: [false, false] });
  const confirmLeaveRef = useRef(null);
  const [now, setNow] = useState(Date.now());
  const offset = useRef(0);
  const unmounting = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const baccaratLeaveRef = useRef(baccarat.leaveTable);
  baccaratLeaveRef.current = baccarat.leaveTable;
  const backRef = useRef(() => {});
  const layersRef = useRef({ confirmLeave: false, tableChatOpen: false, tableMenuOpen: false, raiseOpen: false, creatingTable: false, joiningTable: false, panel: '', rules: false, history: false });
  layersRef.current = { confirmLeave, tableChatOpen, tableMenuOpen, raiseOpen, creatingTable, joiningTable, panel, rules, history };
  useEffect(() => {
    const serverTime = (selectedGame === 'baccarat' ? baccarat.serverTime : null) || game.serverTime;
    if (serverTime) offset.current = serverTime - Date.now();
  }, [game.serverTime, baccarat.serverTime, selectedGame]);
  useEffect(() => {
    unmounting.current = false;
    const old = document.activeElement;
    const el = dialog.current;
    if (el && !el.open) el.showModal();
    const closeTopLayer = () => {
      const layers = layersRef.current;
      if (layers.confirmLeave) { setConfirmLeave(false); return true; }
      if (layers.tableChatOpen) { setTableChatOpen(false); return true; }
      if (layers.tableMenuOpen) { setTableMenuOpen(false); return true; }
      if (layers.raiseOpen) { setRaiseOpen(false); setWagerPreview(null); return true; }
      if (layers.creatingTable) { setCreatingTable(false); return true; }
      if (layers.joiningTable) { setJoiningTable(false); return true; }
      if (layers.panel) { setPanel(''); return true; }
      if (layers.rules) { setRules(false); return true; }
      if (layers.history) { setHistory(false); return true; }
      return false;
    };
    const onKeyDown = event => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (!closeTopLayer()) return;
      event.preventDefault();
      event.stopPropagation();
    };
    const onBack = event => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      if (!closeTopLayer()) backRef.current();
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('linliao:back', onBack, true);
    return () => {
      unmounting.current = true;
      clearTimeout(copyCodeTimer.current);
      baccaratLeaveRef.current?.();
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('linliao:back', onBack, true);
      if (el?.open) el.close();
      old?.focus?.();
    };
  }, []);
  useEffect(() => {
    if (!confirmLeave) return;
    const old = document.activeElement;
    confirmLeaveRef.current?.querySelector('button')?.focus();
    return () => old?.focus?.();
  }, [confirmLeave]);
  const table = game.table;
  const baccaratTable = baccarat.table;
  const showBaccarat = Boolean(selectedGame === 'baccarat' && baccaratTable && !browsing);
  const showPoker = Boolean(selectedGame !== 'baccarat' && table && !browsing);
  const showTable = showPoker || showBaccarat;
  const activeTable = showBaccarat ? baccaratTable : showPoker ? table : null;
  const { enabled: sound, toggle: toggleSound, unlock: unlockSound, play: playSound, stop: stopSound } = usePokerAudio(Boolean(showTable), activeTable?.id);
  const hasRecentSpeech = Boolean(activeTable?.messages?.some(message => Date.now() + offset.current - message.at < 6500));
  const needsTick = Boolean(
    (showPoker && (activeHand(table) || Boolean(table.nextHandAt) || hasRecentSpeech))
    || (showBaccarat && (baccaratTable.phase !== 'open' || Boolean(baccaratTable.squeeze) || hasRecentSpeech)),
  );
  useEffect(() => {
    if (!needsTick) return;
    setNow(Date.now() + offset.current);
    const timer = setInterval(() => setNow(Date.now() + offset.current), 250);
    return () => clearInterval(timer);
  }, [needsTick, activeTable?.messages?.length, table?.handId, table?.phase, table?.nextHandAt, baccaratTable?.roundId, baccaratTable?.phase, baccaratTable?.squeeze?.step]);
  useTableMotion(table, stage, Boolean(showPoker), playSound, stopSound);
  const seatedSelf = table?.players.find(player => player.id === me.id);
  const own = seatedSelf && !seatedSelf.leaving ? seatedSelf : null;
  useEffect(() => { if (!own) setConfirmLeave(false); }, [own]);
  const handKey = `${table?.id || ''}:${table?.handId || 0}`;
  const effectiveCovered = coverState.handKey === handKey ? coverState.flags : [privacyMode, privacyMode];
  const effectivePeeking = peekState.handKey === handKey ? peekState.flags : [false, false];
  const cardStateRef = useRef({ handKey, privacyMode });
  cardStateRef.current = { handKey, privacyMode };
  useEffect(() => {
    const clearPeek = () => setPeekState(prev => (prev.flags[0] || prev.flags[1] ? { handKey: prev.handKey, flags: [false, false] } : prev));
    const onVisibility = () => { if (document.hidden) clearPeek(); };
    window.addEventListener('blur', clearPeek);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('blur', clearPeek);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);
  const toggleCardCover = useCallback(index => {
    const { handKey: key, privacyMode: def } = cardStateRef.current;
    setPeekState(prev => {
      const flags = prev.handKey === key ? [...prev.flags] : [false, false];
      if (!flags[index]) return prev.handKey === key ? prev : { handKey: key, flags };
      flags[index] = false;
      return { handKey: key, flags };
    });
    setCoverState(prev => {
      const flags = prev.handKey === key ? [...prev.flags] : [def, def];
      flags[index] = !flags[index];
      return { handKey: key, flags };
    });
    playSound('flip', { pan: index === 0 ? -0.18 : -0.12 });
  }, [playSound]);
  const setCardPeek = useCallback((index, active) => {
    const { handKey: key } = cardStateRef.current;
    setPeekState(prev => {
      const flags = prev.handKey === key ? [...prev.flags] : [false, false];
      if (flags[index] === active) return prev;
      flags[index] = active;
      return { handKey: key, flags };
    });
    playSound('flip', { pan: index === 0 ? -0.18 : -0.12 });
  }, [playSound]);
  const togglePrivacy = () => {
    const next = !privacyMode;
    setPrivacyMode(next);
    try { localStorage.setItem(PRIVACY_KEY, next ? 'on' : 'off'); } catch {}
    const canCoverOwn = Boolean(own?.inHand && !(table?.phase === 'showdown' && !own.folded));
    const shouldFlipSound = canCoverOwn && [0, 1].some(i => own.cards?.[i] && (next ? (!effectiveCovered[i] || effectivePeeking[i]) : effectiveCovered[i]));
    setCoverState({ handKey, flags: [next, next] });
    setPeekState({ handKey, flags: [false, false] });
    if (shouldFlipSound) playSound('flip', { pan: -0.15 });
  };
  const viewBaccarat = useCallback(async id => {
    setSelectedGame('baccarat');
    setPanel('');
    await baccarat.inspect(id);
    setBrowsing(false);
  }, [baccarat.inspect]);
  useEffect(() => {
    const applyJoined = detail => {
      if (detail?.game === 'baccarat' && detail.id) {
        viewBaccarat(detail.id);
      } else {
        setSelectedGame('poker');
        setBrowsing(false);
        setPanel('');
      }
    };
    const pending = window.__linliaoArcadePendingJoin;
    if (pending && Date.now() - pending.at < 15000) {
      delete window.__linliaoArcadePendingJoin;
      applyJoined(pending);
    }
    const joined = event => {
      delete window.__linliaoArcadePendingJoin;
      applyJoined(event.detail);
    };
    window.addEventListener('linliao:arcade-joined', joined);
    return () => window.removeEventListener('linliao:arcade-joined', joined);
  }, [viewBaccarat]);
  const command = async (action, body) => {
    const next = await game.command(action, body);
    if (action === 'leave') {
      setConfirmLeave(false);
      if (next && !next.table) { setBrowsing(true); setSelectedGame('poker'); }
    } else if (next && ['create', 'join', 'enter'].includes(action)) { setSelectedGame('poker'); setBrowsing(false); }
    return Boolean(next);
  };
  useEffect(() => { setCopiedCode(false); }, [table?.id, table?.roomCode]);
  const copyRoomCode = async () => {
    if (!table?.roomCode) return;
    try {
      await copyText(table.roomCode);
      setCopiedCode(true);
      clearTimeout(copyCodeTimer.current);
      copyCodeTimer.current = setTimeout(() => setCopiedCode(false), 1800);
    } catch {}
  };
  const view = async id => { setSelectedGame('poker'); await game.inspect(id); setBrowsing(false); };
  const mySeat = seatedSelf?.seat ?? 0;
  const winners = table?.result?.winners || [];
  const back = () => {
    if (showBaccarat) {
      setTableChatOpen(false); setTableMenuOpen(false); setHistory(false); setRules(false);
      setBrowsing(true); setSelectedGame('baccarat');
      baccarat.leaveTable();
      game.refresh();
    } else if (showPoker) {
      setTableChatOpen(false); setTableMenuOpen(false); setRaiseOpen(false); setHistory(false); setRules(false);
      setBrowsing(true); setSelectedGame('poker');
      game.clearSelection();
    } else if (selectedGame) {
      setSelectedGame(null);
      setRules(false);
    } else onClose();
  };
  backRef.current = back;
  useEffect(() => { setTableChatOpen(false); setTableMenuOpen(false); setRaiseOpen(false); setHistory(false); setChatSeenCount(activeTable?.messages?.length || 0); }, [activeTable?.id, showTable]);
  const msgTotal = activeTable?.messages?.length || 0;
  useEffect(() => { if (tableChatOpen) setChatSeenCount(msgTotal); }, [tableChatOpen, msgTotal]);
  const unreadChat = showTable && !tableChatOpen ? Math.max(0, msgTotal - chatSeenCount) : 0;
  const nativeMac = window.desktop?.platform === 'macos';
  const leavingInHand = Boolean(table && activeHand(table) && own?.inHand);
  const leavingSettling = Boolean(leavingInHand && (own.folded || own.allIn));
  const activeError = selectedGame === 'baccarat' ? (baccarat.error || game.error) : game.error;
  const refreshAll = () => { game.refresh(); if (selectedGame === 'baccarat') baccarat.refresh(); };
  const headerCrumb = showBaccarat ? baccaratTable.name : showPoker ? table.name : selectedGame === 'baccarat' ? '澳门百家乐' : selectedGame === 'poker' ? '德州扑克' : '全部游戏';
  const backLabel = showBaccarat ? '返回百家乐大厅' : showPoker ? '返回德州大厅' : selectedGame ? '返回游戏列表' : '返回聊天';
  return <dialog ref={dialog} className={`arcade-dialog ${nativeMac ? 'is-mac' : ''}`} aria-labelledby="arcade-title"
    onPointerDownCapture={unlockSound} onKeyDownCapture={unlockSound}
    onCancel={event => {
      event.preventDefault(); event.stopPropagation();
      if (confirmLeave) setConfirmLeave(false);
      else if (tableChatOpen) setTableChatOpen(false);
      else if (tableMenuOpen) setTableMenuOpen(false);
      else if (raiseOpen) { setRaiseOpen(false); setWagerPreview(null); }
      else if (creatingTable) setCreatingTable(false);
      else if (joiningTable) setJoiningTable(false);
      else if (panel) setPanel('');
      else if (rules) setRules(false);
      else if (history) setHistory(false);
      else onClose();
    }}
    onClose={() => { if (!unmounting.current && !dialog.current?.open) onCloseRef.current(); }}>
    <div className="arcade-app">{nativeMac && <div className="arcade-window-chrome" data-drag-region aria-hidden="true" />}
      {mobile && showPoker ? <header className="mobile-poker-header">
        <button type="button" className="arcade-back" onClick={back} aria-label="返回德州大厅"><ArrowLeft size={20} /></button>
        <div className="mobile-poker-title">
          <h1 id="arcade-title">{table.visibility === 'private' && <Lock size={13} className="mobile-private-icon" aria-label="私密牌桌" />}<span>{table.name}</span></h1>
          <p><i className={`mobile-net-dot ${connected ? '' : 'offline'}`} />盲注 {table.smallBlind}/{table.bigBlind} · 第{table.matchNumber}场 {table.matchHandNumber}{table.handLimit ? `/${table.handLimit}` : ''}手</p>
        </div>
        <div className="mobile-poker-actions">
          <button type="button" className={`privacy-toggle-btn ${privacyMode ? 'active' : ''}`} onClick={togglePrivacy} aria-pressed={privacyMode} aria-label={privacyMode ? '关闭防窥模式' : '开启防窥模式'}>{privacyMode ? <EyeOff size={18} /> : <Eye size={18} />}</button>
          <button type="button" className={tableChatOpen ? 'active' : undefined} onClick={() => setTableChatOpen(v => !v)} aria-label="牌桌聊天" aria-expanded={tableChatOpen}><MessageSquare size={18} />{unreadChat > 0 && <span className="mobile-chat-badge">{unreadChat > 99 ? '99+' : unreadChat}</span>}</button>
          <button type="button" onClick={() => setTableMenuOpen(true)} aria-label="牌桌菜单" aria-expanded={tableMenuOpen}><MoreHorizontal size={20} /></button>
        </div>
      </header>
      : mobile && showBaccarat ? <header className="mobile-poker-header">
        <button type="button" className="arcade-back" onClick={back} aria-label="返回百家乐大厅"><ArrowLeft size={20} /></button>
        <div className="mobile-poker-title">
          <h1 id="arcade-title">{baccaratTable.name}</h1>
          <p><i className={`mobile-net-dot ${connected ? '' : 'offline'}`} />限红 {number(baccaratTable.minBet)}-{number(baccaratTable.maxBet)} · 第{baccaratTable.shoeNumber}靴 剩{baccaratTable.cardsRemaining}张</p>
        </div>
        <div className="mobile-poker-actions">
          <button type="button" className={baccaratTable.mySqueezeEnabled ? 'active' : undefined} onClick={() => baccarat.command('squeeze', { id: baccaratTable.id, enabled: !baccaratTable.mySqueezeEnabled })} aria-pressed={baccaratTable.mySqueezeEnabled} aria-label={baccaratTable.mySqueezeEnabled ? '切换快速开牌' : '开启咪牌模式'}>{baccaratTable.mySqueezeEnabled ? <Hand size={18} /> : <Zap size={18} />}</button>
          <button type="button" className={tableChatOpen ? 'active' : undefined} onClick={() => setTableChatOpen(v => !v)} aria-label="牌桌聊天" aria-expanded={tableChatOpen}><MessageSquare size={18} />{unreadChat > 0 && <span className="mobile-chat-badge">{unreadChat > 99 ? '99+' : unreadChat}</span>}</button>
          <button type="button" onClick={() => setTableMenuOpen(true)} aria-label="牌桌菜单" aria-expanded={tableMenuOpen}><MoreHorizontal size={20} /></button>
        </div>
      </header>
      : <header className="arcade-header"><button className="arcade-back" onClick={back} aria-label={backLabel}><ArrowLeft size={19} /></button><div className="arcade-wordmark"><ArcadeIcon size={25} /><h1 id="arcade-title">游戏厅</h1><span>/</span><b>{headerCrumb}</b></div><span className={`arcade-network ${connected ? '' : 'offline'}`}><i />{connected ? '在线' : '重连中'}</span><button className="arcade-close" onClick={onClose}><span>返回聊天</span><X size={18} /></button></header>}
      {activeError && <div className="arcade-error" role="alert"><span>{activeError}</span><button onClick={refreshAll} aria-label="重新连接游戏厅"><RefreshCw size={16} /></button></div>}
      {!connected && <div className="arcade-disconnected" role="status">正在重新连接，行动暂不可用；恢复后自动同步牌局。</div>}
      {game.loading && !game.tables ? <div className="arcade-loading" role="status"><RefreshCw size={25} className="spin" /><p>正在连接游戏厅…</p></div>
        : showBaccarat ? (
          <BaccaratRoom
            table={baccaratTable}
            wallet={baccarat.wallet || game.wallet}
            me={me}
            connected={connected}
            busy={baccarat.busy}
            now={now}
            mobile={mobile}
            sound={sound}
            onToggleSound={toggleSound}
            playSound={playSound}
            onCommand={baccarat.command}
            onPanel={setPanel}
            onRules={() => setRules(v => !v)}
            chatOpen={tableChatOpen}
            onChatOpen={setTableChatOpen}
            historyOpen={history}
            onHistoryOpen={setHistory}
            unreadChat={unreadChat}
          />
        ) : !showPoker ? (
          <ArcadeLobby
            game={game}
            baccarat={baccarat}
            me={me}
            connected={connected}
            table={table}
            selectedGame={selectedGame}
            creating={creatingTable}
            onCreating={setCreatingTable}
            joining={joiningTable}
            onJoining={setJoiningTable}
            onSelect={setSelectedGame}
            onView={view}
            onViewBaccarat={viewBaccarat}
            onReturn={() => { setSelectedGame('poker'); setBrowsing(false); }}
            onCommand={command}
            onPanel={setPanel}
            onRules={() => setRules(true)}
            roomIcon={<Suit suit="s" />}
            art={<><div className="feature-orbit" /><div className="hero-card card-one"><Card card="As" /></div><div className="hero-card card-two"><Card card="Ah" /></div><div className="hero-chip-stack"><Chips amount={500} /></div></>}
            baccaratArt={<><div className="feature-orbit" /><div className="hero-card card-one"><Card card="9h" /></div><div className="hero-card card-two"><Card card="Ks" /></div><div className="hero-chip-stack"><Chips amount={1000} /></div></>}
          />
        ) : <main className="poker-room">{!mobile && <div className="poker-room-top"><div><span className="poker-live-dot" /><b>德州扑克</b>{table.visibility === 'private' && <span className="poker-private-badge"><Lock size={11} />私密</span>}{table.visibility === 'private' && table.roomCode && <button type="button" className={`poker-room-code ${copiedCode ? 'is-copied' : ''}`} onClick={copyRoomCode} title="点击复制房间口令"><span>口令</span><b>{table.roomCode}</b>{copiedCode ? <Check size={12} /> : <Copy size={12} />}</button>}<span>盲注 {table.smallBlind} / {table.bigBlind}</span><span>第 {table.matchNumber} 场 · {table.matchHandNumber}{table.handLimit ? ` / ${table.handLimit}` : ''} 手{!table.handLimit && ' · 不限'}</span></div><div className="poker-tools"><button onClick={() => setPanel('rank')} aria-label="排行榜"><Trophy size={17} /></button><button onClick={() => setPanel('wallet')} aria-label="我的筹码"><Coins size={17} /></button>{own && <button onClick={() => { game.clearError?.(); setPanel('invite'); }} aria-label="邀请好友进房"><UserPlus size={17} /></button>}{own && table.hostId === me.id && <button onClick={() => { game.clearError?.(); setPanel('stakes'); }} disabled={game.busy || !connected || activeHand(table)} aria-label="牌桌设置" title={activeHand(table) ? '本手结束后可调整牌桌设置' : '牌桌设置'}><SlidersHorizontal size={17} /></button>}<button onClick={toggleSound} aria-label={sound ? '关闭游戏声音' : '开启游戏声音'} aria-pressed={sound}>{sound ? <Volume2 size={17} /> : <VolumeX size={17} />}</button><button className="privacy-toggle-btn" onClick={togglePrivacy} aria-pressed={privacyMode} aria-label={privacyMode ? '关闭防窥模式（新局默认明牌）' : '开启防窥模式（新局默认盖牌）'} title={privacyMode ? '防窥模式已开启：新局自动盖牌，点击关闭并翻开当前底牌' : '开启防窥模式：立即盖住当前底牌，且新局自动盖牌'}>{privacyMode ? <EyeOff size={17} /> : <Eye size={17} />}</button><button onClick={() => setHistory(value => !value)} aria-label="本局记录" aria-pressed={history}><History size={17} /></button><button onClick={() => setRules(value => !value)} aria-label="玩法规则" aria-pressed={rules}><CircleHelp size={17} /></button>{own && <button className="leave-table" disabled={game.busy || !connected} aria-pressed={own.leaveAfterHand} title={own.leaveAfterHand ? '取消本局后离桌' : leavingInHand ? '离桌或预约本局后离桌' : '离桌并退回筹码'} onClick={() => own.leaveAfterHand ? command('leave', { id: table.id, mode: 'cancel' }) : setConfirmLeave(true)}><LogOut size={16} /><span>{own.leaveAfterHand ? '取消离桌' : '离桌'}</span></button>}</div></div>}
        <div className="poker-layout"><section ref={stage} className={`poker-stage ${table.phase === 'showdown' ? 'settled' : ''}`} aria-label="德州扑克牌桌"><div className="poker-ambient" /><div className="poker-felt"><TableEngraving /><div className="felt-stitch" /><div className="felt-label">虾扯蛋 <span>POKER CLUB</span></div><div className="board-area"><span className="street-label">{PHASE[table.phase]}</span><div className="pot-rack" data-pot-anchor><Chips unit={table.smallBlind} amount={table.phase === 'showdown' ? 0 : Math.max(0, table.pot - table.players.reduce((sum, player) => sum + player.bet, 0))} /></div><div className="poker-pot" key={`${table.handId}-${table.pot}`}><span>底池</span><strong>{number(table.pot)}</strong></div><div className="community-cards">{Array.from({ length: 5 }, (_, i) => table.board[i] ? <Card key={`${table.handId}-${i}`} card={table.board[i]} index={i} boardIndex={i} /> : <div className="card-placeholder" key={`empty-${i}`}><Suit suit={i % 2 ? 'h' : 's'} /></div>)}</div>{table.phase === 'waiting' && <p className="board-hint">入座，准备，开始一局。</p>}{table.phase === 'showdown' && winners.length > 0 && <div className="poker-result" role="status" key={table.handId}><strong>{winners.map(winner => winner.name || table.players.find(player => player.id === winner.id)?.name || '玩家').join('、')} {winners.length > 1 ? '分享底池' : '赢得底池'}</strong><span>{table.result.reason === 'fold' ? '其他玩家弃牌' : [...new Set(winners.map(winner => winner.hand).filter(Boolean))].join(' · ')}</span></div>}</div></div>
          <DealerArm phase={table.phase} handId={table.handId} />
          <div className="poker-deck" data-deal-origin aria-hidden="true"><Card back small /><Card back small /></div>
          <div className="poker-scoreboard"><div><span>盲注 {table.smallBlind} / {table.bigBlind}</span><b>{table.matchComplete ? '本场结束' : PHASE[table.phase]}</b></div><div><span>底池总额</span><Counter value={table.pot} /><i className="street-lights">{[0, 1, 2, 3].map(i => <em key={i} className={['preflop', 'flop', 'turn', 'river', 'showdown'].indexOf(table.phase) >= i ? 'on' : ''} />)}</i></div></div>
          {Array.from({ length: 6 }, (_, position) => { const seat = (position + mySeat) % 6; const player = table.players.find(item => item.seat === seat); const isMine = player?.id === me.id; return <Seat key={seat} position={position} player={player} table={table} me={me} busy={game.busy || Boolean(seatedSelf) || !connected} onJoin={() => command('join', { id: table.id, seat })} now={now} preview={wagerPreview?.handId === table.handId && wagerPreview?.seat === seat && table.actions?.canAct ? wagerPreview.amount : 0} coveredCards={isMine ? effectiveCovered : undefined} peekingCards={isMine ? effectivePeeking : undefined} onToggleCover={isMine ? toggleCardCover : undefined} onPeekChange={isMine ? setCardPeek : undefined} />; })}
          <div className="table-motion-layer" aria-hidden="true" /><span className="table-id">{table.roomCode || table.id.slice(0, 8).toUpperCase()}</span>
        </section>{mobile && history && <div className="poker-ledger-backdrop" onClick={() => setHistory(false)} />}<aside className={`poker-ledger ${history ? 'show-ledger' : ''}`}>{mobile && <span className="arcade-sheet-grabber" aria-hidden="true" />}<div className="ledger-heading"><h3>本局记录</h3><button className="mobile-ledger-close" onClick={() => setHistory(false)} aria-label="收起记录"><X size={17} /></button></div><div className="ledger-pot"><span>底池总额</span><strong>{number(table.pot)}</strong><small>{table.players.filter(player => player.inHand && !player.folded).length} 人仍在本局</small></div><ol>{[...(table.log || [])].reverse().slice(0, 20).map(entry => <li key={entry.id}><span>{entry.text}</span><time>{new Date(entry.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time></li>)}</ol>{table.result?.pots?.length > 1 && <div className="side-pots">{table.result.pots.map((pot, index) => <div key={index}><span>{index ? `边池 ${index}` : '主池'}</span><b>{number(pot.amount)}</b></div>)}</div>}<div className="ledger-footer">2–6 人 · 虚拟筹码</div></aside></div>
        <TableChat table={table} own={own} busy={game.busy || !connected} onCommand={command} mobile={mobile} mobileOpen={tableChatOpen} onMobileClose={() => setTableChatOpen(false)} /><Actions table={table} me={me} busy={game.busy} connected={connected} onCommand={command} wallet={game.wallet} onStakes={() => { game.clearError?.(); setPanel('stakes'); }} onPreview={setWagerPreview} now={now} mobile={mobile} raiseOpen={raiseOpen} setRaiseOpen={setRaiseOpen} />
      </main>}
      {mobile && showPoker && tableMenuOpen && <Sheet title="牌桌菜单" icon={<MoreHorizontal size={20} />} onClose={() => setTableMenuOpen(false)}>
        {table.visibility === 'private' && table.roomCode && (
          <div className="arcade-code-card compact mobile-menu-code">
            <div className="arcade-code-meta">
              <span><Lock size={13} />私密房间口令</span>
              <strong>{table.roomCode}</strong>
            </div>
            <button type="button" className="arcade-secondary arcade-code-action" onClick={copyRoomCode}>
              {copiedCode ? <><Check size={14} />已复制</> : <><Copy size={14} />复制口令</>}
            </button>
          </div>
        )}
        <div className="mobile-poker-menu-grid">
          <button type="button" onClick={() => { setTableMenuOpen(false); setPanel('rank'); }}><Trophy size={20} /><span>排行榜</span></button>
          <button type="button" onClick={() => { setTableMenuOpen(false); setPanel('wallet'); }}><Coins size={20} /><span>我的筹码</span></button>
          {own && <button type="button" onClick={() => { setTableMenuOpen(false); game.clearError?.(); setPanel('invite'); }}><UserPlus size={20} /><span>邀请好友</span></button>}
          {own && table.hostId === me.id && <button type="button" disabled={game.busy || !connected || activeHand(table)} onClick={() => { setTableMenuOpen(false); game.clearError?.(); setPanel('stakes'); }}><SlidersHorizontal size={20} /><span>牌桌设置</span></button>}
          <button type="button" onClick={() => { setTableMenuOpen(false); setHistory(true); }}><History size={20} /><span>本局记录</span></button>
          <button type="button" onClick={() => { setTableMenuOpen(false); setRules(true); }}><CircleHelp size={20} /><span>玩法规则</span></button>
          <button type="button" className={sound ? 'active' : undefined} onClick={toggleSound}>{sound ? <Volume2 size={20} /> : <VolumeX size={20} />}<span>{sound ? '声音已开' : '声音已关'}</span></button>
          {own && <button type="button" className={own.autoplay ? 'active' : undefined} disabled={game.busy || !connected} onClick={() => { setTableMenuOpen(false); command('autoplay', { id: table.id, enabled: !own.autoplay }); }}><Bot size={20} /><span>{own.autoplay ? '接回操作' : '托管'}</span></button>}
          <button type="button" onClick={() => { setTableMenuOpen(false); onClose(); }}><X size={20} /><span>返回聊天</span></button>
        </div>
        {own && <button type="button" className="mobile-poker-menu-leave" disabled={game.busy || !connected} onClick={() => { setTableMenuOpen(false); if (own.leaveAfterHand) command('leave', { id: table.id, mode: 'cancel' }); else setConfirmLeave(true); }}>
          <LogOut size={17} /><span>{own.leaveAfterHand ? '取消本局后离桌' : '离开牌桌'}</span>
        </button>}
      </Sheet>}
      {mobile && showBaccarat && tableMenuOpen && <Sheet title="牌桌菜单" icon={<MoreHorizontal size={20} />} onClose={() => setTableMenuOpen(false)}>
        <div className="mobile-poker-menu-grid">
          <button type="button" onClick={() => { setTableMenuOpen(false); setPanel('rank'); }}><Trophy size={20} /><span>排行榜</span></button>
          <button type="button" onClick={() => { setTableMenuOpen(false); setPanel('wallet'); }}><Coins size={20} /><span>我的筹码</span></button>
          <button type="button" onClick={() => { setTableMenuOpen(false); setPanel('invite'); }}><UserPlus size={20} /><span>邀请好友</span></button>
          <button type="button" onClick={() => { setTableMenuOpen(false); setHistory(true); }}><History size={20} /><span>本靴记录</span></button>
          <button type="button" onClick={() => { setTableMenuOpen(false); setRules(true); }}><CircleHelp size={20} /><span>玩法规则</span></button>
          <button type="button" className={sound ? 'active' : undefined} onClick={toggleSound}>{sound ? <Volume2 size={20} /> : <VolumeX size={20} />}<span>{sound ? '声音已开' : '声音已关'}</span></button>
          <button type="button" className={baccaratTable.mySqueezeEnabled ? 'active' : undefined} disabled={!connected} onClick={() => { setTableMenuOpen(false); baccarat.command('squeeze', { id: baccaratTable.id, enabled: !baccaratTable.mySqueezeEnabled }); }}>{baccaratTable.mySqueezeEnabled ? <Hand size={20} /> : <Zap size={20} />}<span>{baccaratTable.mySqueezeEnabled ? '咪牌已开' : '极速开牌'}</span></button>
          <button type="button" onClick={() => { setTableMenuOpen(false); onClose(); }}><X size={20} /><span>返回聊天</span></button>
        </div>
        <button type="button" className="mobile-poker-menu-leave" onClick={() => { setTableMenuOpen(false); back(); }}>
          <LogOut size={17} /><span>切换牌桌</span>
        </button>
      </Sheet>}
      {panel === 'stakes' && showPoker && table && <StakesPanel table={table} onCommand={command} error={game.error} onClose={() => { game.clearError?.(); setPanel(''); }} />}
      {panel === 'rank' && <Leaderboard me={me} initialGame={selectedGame === 'baccarat' ? 'baccarat' : 'poker'} onClose={() => setPanel('')} />}
      {panel === 'wallet' && <WalletPanel me={me} onClose={() => setPanel('')} onChanged={refreshAll} />}
      {panel === 'invite' && showPoker && table && <InvitePanel table={table} error={game.error} onCommand={command} onClose={() => { game.clearError?.(); setPanel(''); }} maxPlayers={6} />}
      {panel === 'invite' && showBaccarat && baccaratTable && <InvitePanel table={baccaratTable} error={baccarat.error} onCommand={baccarat.command} onClose={() => setPanel('')} maxPlayers={0} />}
      {rules && (selectedGame === 'baccarat' ? <BaccaratRules mobile={mobile} onClose={() => setRules(false)} /> : <Rules mobile={mobile} onClose={() => setRules(false)} />)}
      {confirmLeave && own && <div className="arcade-confirm" onClick={event => { if (event.target === event.currentTarget) setConfirmLeave(false); }}><div ref={confirmLeaveRef} role="alertdialog" aria-modal="true" aria-labelledby="leave-title"><h3 id="leave-title">离开牌桌？</h3><p>{leavingInHand ? own.allIn ? '你已全下，本手仍会正常结算。你可以现在退出牌桌，或等本手结束后自动离桌，筹码都会在结算后自动退回账户。' : own.folded ? '你已弃牌。你可以现在退出牌桌，或等本手结束后自动离桌，剩余筹码会在结算后自动退回账户。' : '选择「本局后离桌」可打完这一手并在结算后自动退回筹码；选择「立即离桌」会退出牌桌，轮到你时自动过牌或弃牌，本手结算后退回剩余筹码。' : `离桌后，剩余 ${number(own.stack)} 筹码会立即退回账户。`}</p><div><button className="arcade-secondary" onClick={() => setConfirmLeave(false)}>继续玩</button>{leavingInHand ? leavingSettling ? <><button className="arcade-secondary" disabled={game.busy} onClick={() => command('leave', { id: table.id, mode: 'after' })}>本局后离桌</button><button className="arcade-primary" disabled={game.busy} onClick={() => command('leave', { id: table.id, mode: 'now' })}>立即离桌</button></> : <><button className="arcade-secondary" disabled={game.busy} onClick={() => command('leave', { id: table.id, mode: 'now' })}>立即离桌</button><button className="arcade-primary" disabled={game.busy} onClick={() => command('leave', { id: table.id, mode: 'after' })}>本局后离桌</button></> : <button className="arcade-primary" disabled={game.busy} onClick={() => command('leave', { id: table.id, mode: 'now' })}>确认离桌</button>}</div></div></div>}
    </div>
  </dialog>;
}
