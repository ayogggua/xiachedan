import React, { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CircleHelp, Coins, Eye, EyeOff, History, LogOut, Minus, Plus, RefreshCw, Send, Trophy, UserPlus, Volume2, VolumeX, X } from 'lucide-react';
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
const PRIVACY_KEY = 'linliao.arcade.privacy';
const PEEK_DELAY_MS = 220;
const PEEK_DRAG_LIMIT = 18;
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

function Counter({ value }) {
  const text = number(value);
  return <strong className="mechanical-counter" aria-label={text}>{text.split('').map((char, i) => <span key={text.length - i} className={char === ',' ? 'counter-sep' : 'counter-digit'}><b key={char}>{char}</b></span>)}</strong>;
}

function CardPips({ rank, suit }) {
  if ('JQK'.includes(rank)) {
    const isRed = suit === 'h' || suit === 'd';
    const cloak = isRed ? '#a82230' : '#1b2d34';
    const cloakTrim = isRed ? '#d4a64c' : '#c8a454';
    const accent = isRed ? '#751520' : '#113a2d';
    return <svg className="card-portrait" viewBox="0 0 60 94" aria-hidden="true">
      <rect x="1" y="1" width="58" height="92" rx="2" fill="#f7f1e1" stroke="#b9964e" strokeWidth="0.9" />
      <rect x="3.5" y="3.5" width="53" height="87" rx="1" fill="none" stroke={cloak} strokeWidth="0.55" strokeOpacity="0.55" />
      <line x1="4" y1="47" x2="56" y2="47" stroke="#c8a454" strokeWidth="0.55" strokeDasharray="1.8 1.5" strokeOpacity="0.7" />
      {[false, true].map(flip => <g key={String(flip)} transform={flip ? 'rotate(180 30 47)' : undefined}>
        <path d="M10 46.5 12 33 23 28H37L48 33 50 46.5Z" fill={cloak} stroke="#28221b" strokeWidth="0.7" />
        <path d="M23 28.5 29 46.5H33.5L37 28.5" fill={accent} />
        <path d="M16 32.5 20.5 46.5M44 32.5 39.5 46.5" stroke={cloakTrim} strokeWidth="3.2" />
        <path d="M18 35.5 21 46.5M42 35.5 39 46.5" stroke="#f4dea4" strokeWidth="0.7" />
        <path d="M23 15.5Q30 8.5 37 15.5L36 25 30 30.5 24 25Z" fill="#f6e6c7" stroke="#473a29" strokeWidth="0.75" />
        <path d="M20.5 16 23 8.5 27 11.5 30 6 33 11.5 37 8.5 39.5 16Z" fill="#d2ac57" stroke="#5c4722" strokeWidth="0.7" />
        <path d="M25.8 19.8h2.2m4 0h2.2M27.8 25.4h4.4" fill="none" stroke="#362c20" strokeWidth="0.9" strokeLinecap="round" />
        <path d="M9.5 8V40.5" stroke="#7c6335" strokeWidth="1.35" />
        <path d="m6.8 12.5 2.7-6.5 2.7 6.5" fill="#d2ac57" stroke="#5c4722" strokeWidth="0.55" />
        {rank === 'K' && <path d="m25 24 5 6.8 5-6.8" fill="none" stroke="#4d3a27" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" />}
        {rank === 'Q' && <circle cx="30" cy="10.2" r="1.4" fill="#f8f2e2" stroke="#5c4722" strokeWidth="0.5" />}
        {rank === 'J' && <path d="M37.5 12.5Q43 9 45 14" fill="none" stroke={cloakTrim} strokeWidth="1.2" strokeLinecap="round" />}
      </g>)}
    </svg>;
  }
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

const Card = memo(function Card({ card, back = false, index = 0, boardIndex, small = false, winner = false, coverable = false, covered = false, peeking = false, onToggleCover, onPeekChange }) {
  const rank = card?.slice(0, -1), suit = card?.slice(-1);
  const color = suit === 'h' || suit === 'd' ? 'red' : 'black';
  const faceRef = useRef(null);
  const glintRef = useRef(null);
  const prevBackRef = useRef(back);
  const prevCoverableRef = useRef(coverable);
  const animRef = useRef({ face: null, glint: null });
  const pressRef = useRef(null);
  const handledPointerRef = useRef(false);
  const handledResetRef = useRef(0);
  const peekCbRef = useRef(onPeekChange);
  peekCbRef.current = onPeekChange;

  const cancelPress = useCallback((releasePeek = true) => {
    const press = pressRef.current;
    if (!press) return;
    pressRef.current = null;
    if (press.timer) clearTimeout(press.timer);
    if (releasePeek && press.peeked) peekCbRef.current?.(index, false);
  }, [index]);

  useEffect(() => {
    if (!coverable) cancelPress(false);
  }, [coverable, cancelPress]);

  useEffect(() => {
    const onBlur = () => cancelPress(true);
    const onVisibility = () => { if (document.hidden) cancelPress(true); };
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
      cancelPress(false);
      if (handledResetRef.current) clearTimeout(handledResetRef.current);
      animRef.current.face?.cancel();
      animRef.current.glint?.cancel();
    };
  }, [cancelPress]);

  useLayoutEffect(() => {
    const wasBack = prevBackRef.current;
    const wasCoverable = prevCoverableRef.current;
    prevBackRef.current = back;
    prevCoverableRef.current = coverable;
    if (wasBack === back || (!coverable && !wasCoverable)) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const face = faceRef.current;
    if (!face?.animate) return;
    animRef.current.face?.cancel();
    animRef.current.glint?.cancel();
    const frames = back
      ? [
        { transform: 'perspective(900px) rotateY(84deg) scale(0.95)' },
        { transform: 'perspective(900px) rotateY(-5deg) scale(1.02)', offset: 0.72 },
        { transform: 'perspective(900px) rotateY(0deg) scale(1)' },
      ]
      : peeking
        ? [
          { transform: 'perspective(900px) translateY(-2px) rotateY(-84deg) scale(0.96)' },
          { transform: 'perspective(900px) translateY(-12px) rotateY(7deg) scale(1.06)', offset: 0.72 },
          { transform: 'perspective(900px) translateY(-10px) rotateY(0deg) scale(1.045)' },
        ]
        : [
          { transform: 'perspective(900px) rotateY(-84deg) scale(0.94)' },
          { transform: 'perspective(900px) rotateY(7deg) scale(1.03)', offset: 0.72 },
          { transform: 'perspective(900px) rotateY(0deg) scale(1)' },
        ];
    const faceAnim = face.animate(frames, { duration: 250, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
    animRef.current.face = faceAnim;
    faceAnim.onfinish = () => { if (animRef.current.face === faceAnim) animRef.current.face = null; };
    if (!back && glintRef.current?.animate) {
      const glintAnim = glintRef.current.animate([
        { transform: 'translate3d(-135%, 0, 0) skewX(-22deg)', opacity: 0 },
        { transform: 'translate3d(-15%, 0, 0) skewX(-22deg)', opacity: 0.92, offset: 0.42 },
        { transform: 'translate3d(135%, 0, 0) skewX(-22deg)', opacity: 0 },
      ], { duration: 420, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
      animRef.current.glint = glintAnim;
      glintAnim.onfinish = () => { if (animRef.current.glint === glintAnim) animRef.current.glint = null; };
    }
  }, [back, coverable, peeking]);

  const tilt = event => {
    const press = pressRef.current;
    if (press && press.pointerId === event.pointerId && !press.peeked && !press.dragged) {
      if (Math.hypot(event.clientX - press.startX, event.clientY - press.startY) > PEEK_DRAG_LIMIT) {
        press.dragged = true;
        if (press.timer) { clearTimeout(press.timer); press.timer = 0; }
      }
    }
    if ((press && back) || event.pointerType === 'touch' || !window.matchMedia?.('(hover: hover) and (pointer: fine)').matches || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const box = event.currentTarget.getBoundingClientRect();
    const px = (event.clientX - box.left) / box.width;
    const py = (event.clientY - box.top) / box.height;
    event.currentTarget.style.setProperty('--rx', `${-(py - 0.5) * 14}deg`);
    event.currentTarget.style.setProperty('--ry', `${(px - 0.5) * 16}deg`);
    event.currentTarget.style.setProperty('--gx', `${Math.round(px * 100)}%`);
    event.currentTarget.style.setProperty('--gy', `${Math.round(py * 100)}%`);
  };
  const resetTilt = event => {
    event.currentTarget.style.setProperty('--rx', '0deg');
    event.currentTarget.style.setProperty('--ry', '0deg');
    event.currentTarget.style.setProperty('--gx', '50%');
    event.currentTarget.style.setProperty('--gy', '20%');
  };

  const onPointerDown = event => {
    if (!coverable) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    cancelPress(false);
    try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch {}
    const press = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, peeked: false, dragged: false, timer: 0 };
    if (covered && !peeking) {
      press.timer = window.setTimeout(() => {
        if (pressRef.current !== press || press.dragged) return;
        press.timer = 0;
        press.peeked = true;
        peekCbRef.current?.(index, true);
      }, PEEK_DELAY_MS);
    }
    pressRef.current = press;
  };

  const onPointerUp = event => {
    const press = pressRef.current;
    if (!coverable || !press || press.pointerId !== event.pointerId) return;
    pressRef.current = null;
    if (press.timer) clearTimeout(press.timer);
    try { if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); } catch {}
    handledPointerRef.current = true;
    if (handledResetRef.current) clearTimeout(handledResetRef.current);
    handledResetRef.current = window.setTimeout(() => { handledPointerRef.current = false; handledResetRef.current = 0; }, 0);
    if (press.peeked) peekCbRef.current?.(index, false);
    else if (!press.dragged) onToggleCover?.(index);
  };

  const onPointerAbort = event => {
    const press = pressRef.current;
    if (press && press.pointerId === event.pointerId) cancelPress(true);
  };

  const onClick = () => {
    if (!coverable) return;
    if (handledPointerRef.current) { handledPointerRef.current = false; return; }
    onToggleCover?.(index);
  };

  const onKeyDown = event => {
    if (!coverable) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onToggleCover?.(index);
    }
  };

  const onContextMenu = event => { if (coverable) event.preventDefault(); };

  const faceLabel = `${SUITS[suit]} ${rank === 'T' ? '10' : rank}`;
  const ariaLabel = coverable
    ? back
      ? '已盖住的底牌（点击翻开，长按偷看）'
      : peeking
        ? `${faceLabel}（松手自动盖回）`
        : `${faceLabel}（点击盖牌）`
    : back ? '未公开的底牌' : faceLabel;
  const title = coverable ? (back ? '点击翻开，长按偷看' : peeking ? '松手自动盖回' : '点击盖牌防窥') : undefined;

  return <div data-card-index={index} data-board-index={boardIndex}
    data-covered={coverable ? (covered ? 'true' : 'false') : undefined}
    data-peeking={coverable ? (peeking ? 'true' : 'false') : undefined}
    role={coverable ? 'button' : undefined}
    tabIndex={coverable ? 0 : undefined}
    aria-pressed={coverable ? covered : undefined}
    aria-label={ariaLabel}
    title={title}
    className={`poker-card ${back ? 'back' : color} ${small ? 'small' : ''} ${winner && !back ? 'winning' : ''} ${coverable ? 'is-coverable' : ''} ${coverable && covered ? 'is-covered' : ''} ${coverable && peeking ? 'is-peeking' : ''}`}
    style={{ '--deal': `${index * 85}ms` }}
    onPointerDown={onPointerDown} onPointerMove={tilt} onPointerUp={onPointerUp}
    onPointerCancel={onPointerAbort} onLostPointerCapture={onPointerAbort}
    onPointerLeave={resetTilt} onClick={onClick} onKeyDown={onKeyDown} onContextMenu={onContextMenu}>
    {coverable && peeking && <span className="card-peek-tag" aria-hidden="true">偷看中</span>}
    <div ref={faceRef} className="poker-card-face">{back ? <>
      <CardOrnament />
      {coverable && <span className="card-cover-seal" aria-hidden="true"><EyeOff size={10} /></span>}
    </> : <>
      <span className="card-corner"><b>{rank === 'T' ? '10' : rank}</b><Suit suit={suit} /></span><CardPips rank={rank} suit={suit} /><span className="card-corner bottom"><b>{rank === 'T' ? '10' : rank}</b><Suit suit={suit} /></span>
    </>}<span ref={glintRef} className="card-glint" aria-hidden="true" /></div>
  </div>;
});

const Chips = memo(function Chips({ amount = 0, unit = 1, className = '' }) {
  const canvas = useRef(null);
  useLayoutEffect(() => { paintChipPile(canvas.current, amount, unit); }, [amount, unit]);
  return <span className={`poker-chips ${className}`} data-chip-amount={amount} data-chip-unit={unit} aria-hidden="true"><canvas ref={canvas} className="poker-chip-pile" /></span>;
});

function Seat({ player, position, table, me, busy, onJoin, now, preview, coveredCards, peekingCards, onToggleCover, onPeekChange }) {
  if (!player) return <button className={`poker-seat seat-${position} empty-seat`} disabled={busy} onClick={onJoin} aria-label="加入这个牌桌"><span><Plus size={19} /></span><small>空位</small></button>;
  const current = table.turnSeat === player.seat && activeHand(table);
  const mine = player.id === me.id;
  const remaining = Math.max(0, Math.ceil((table.deadline - now) / 1000));
  const urgent = current && !player.autoplay && remaining <= 8;
  const status = player.leaving ? '本局后离桌' : player.autoplay ? '托管中' : !activeHand(table) && player.ready ? '已准备' : player.folded ? '已弃牌' : player.allIn ? '全下' : current ? '思考中' : player.lastAction || (activeHand(table) ? player.inHand ? '等待行动' : '本局旁观' : '等待准备');
  const statusTone = player.allIn ? 'all-in' : player.folded ? 'is-folded-tag' : current ? 'is-turn-tag' : !activeHand(table) && player.ready ? 'is-ready-tag' : '';
  const blindTag = table.smallBlindSeat === player.seat ? '小盲' : table.bigBlindSeat === player.seat ? '大盲' : '';
  const speech = table.messages?.findLast(message => message.userId === player.id && now - message.at < 6500);
  const showdownReveal = table.phase === 'showdown' && !player.folded;
  return <div data-seat={player.seat} className={`poker-seat seat-${position} ${current ? 'is-turn' : ''} ${player.folded ? 'is-folded' : ''} ${player.allIn ? 'is-allin' : ''} ${player.winAmount > 0 ? 'is-winner' : ''} ${mine ? 'is-me' : ''}`}>
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
    })}</div>}
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

function Rules({ onClose }) {
  return <div className="arcade-popover" role="region" aria-label="德州扑克规则"><div><h3>无限注德州扑克</h3><button onClick={onClose} aria-label="收起规则"><X size={18} /></button></div>
    <p>每人 2 张底牌，与 5 张公共牌组成最好的 5 张牌。翻牌前、翻牌、转牌、河牌依次下注。</p>
    <p>每桌底分为小盲注，大盲注为底分的 2 倍；桌主可在开桌或两局之间调整。最小加注幅度等于本轮上一次完整加注；筹码不足可全下，按实际投入分配边池。</p>
    <p>同花顺 ＞ 四条 ＞ 葫芦 ＞ 同花 ＞ 顺子 ＞ 三条 ＞ 两对 ＞ 一对 ＞ 高牌。A 可组成 A2345；花色不分大小，同牌平分。</p>
    <p>首手随机定庄，每手庄家顺时针轮转；两人单挑时庄家兼小盲，翻牌前先行动，翻牌后由大盲先行动。同一场结算后 5 秒自动继续，可在发牌前暂停参与。达到设定手数后结束，再开一场延续庄家轮转。</p>
    <p>每次行动 40 秒；超时进入托管，可过牌时自动过牌，否则弃牌。点击「接回操作」可取消托管。</p>
    <p>每个账号初始 200,000 筹码。牌桌买入从账户扣除，离桌退回剩余筹码；开局后须等本局结束才能离桌。筹码仅供娱乐，不可充值或兑换。</p>
    <p>点击自己的任意一张底牌可单独盖牌防窥；盖牌时长按可临时偷看、松手自动扣回，也可在顶栏开启防窥模式。</p>
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
    return <div className={`poker-waiting ${countdown !== null ? 'is-countdown' : ''}`}><div><strong>{countdown !== null ? `${countdown} 秒后自动发下一手` : table.autoContinue ? '等待玩家继续参与' : '牌桌已就绪。'}</strong><span>{table.autoContinue && own.ready ? '本场连续进行，可在发牌前暂停参与或离桌' : available.length < 2 ? '等待至少 2 位玩家入座' : `${available.filter(player => player.ready).length} / ${available.length} 人已准备`}</span></div>
      <div className="waiting-buttons">{table.hostId === me.id && <button className="arcade-secondary" disabled={locked} onClick={onStakes}>底分 / 手数</button>}<button className="arcade-secondary" disabled={locked || buyIn <= 0} onClick={() => onCommand('rebuy', { id: table.id, amount: buyIn })}>买入 {number(buyIn)}</button>{own.stack > 0 && <button className={own.ready ? 'arcade-secondary' : 'arcade-primary'} disabled={locked} onClick={() => onCommand('ready', { id: table.id, ready: !own.ready })}>{own.ready && <Check size={16} />}{table.autoContinue ? own.ready ? '暂停参与' : '继续参与' : own.ready ? '取消准备' : '准备'}</button>}
        {!table.autoContinue && table.hostId === me.id && <button className="arcade-primary start-hand" disabled={locked || !allReady} onClick={() => onCommand('start', { id: table.id })}>开始发牌<ArrowRight size={16} /></button>}</div>
    </div>;
  }
  if (!actions.canAct) return <div className="poker-waiting"><div><strong>{own.leaving ? '本局结束后离桌' : own.folded ? '你已弃牌' : own.allIn ? '你已全下' : !own.inHand ? '下一局加入' : '等待其他玩家行动'}</strong><span>{table.players.find(player => player.seat === table.turnSeat)?.name ? `${table.players.find(player => player.seat === table.turnSeat).name} 正在行动` : '正在结算'}</span></div><div className="waiting-stack">你的筹码<strong>{number(own.stack)}</strong></div></div>;
  const validRaise = Number.isSafeInteger(raise) && raise >= min && raise <= max;
  const preset = ratio => Math.min(max, Math.max(min, own.bet + actions.toCall + Math.floor((table.pot + actions.toCall) * ratio)));
  const clampedRaise = Math.min(max, Math.max(min, raise));
  const raisePct = max > min ? Math.max(0, Math.min(100, ((clampedRaise - min) / (max - min)) * 100)) : 100;
  return <div className="poker-action-panel"><div className="raise-controls"><span>加注至</span><div className="raise-input"><button disabled={locked || !actions.canRaise} aria-label="减少加注" onClick={() => chooseRaise(Math.max(min, raise - table.bigBlind))}><Minus size={15} /></button><input aria-label="加注总额" type="number" inputMode="numeric" min={min} max={max} step="1" value={raise} disabled={locked || !actions.canRaise} onChange={event => chooseRaise(Number(event.target.value))} /><button disabled={locked || !actions.canRaise} aria-label="增加加注" onClick={() => chooseRaise(Math.min(max, raise + table.bigBlind))}><Plus size={15} /></button></div>
      <input className="raise-slider" aria-label="加注滑杆" type="range" min={Math.min(min, max)} max={max} step="1" value={clampedRaise} style={{ '--raise-pct': `${raisePct}%` }} disabled={locked || !actions.canRaise} onChange={event => chooseRaise(Number(event.target.value))} />
      <div className="raise-presets">{[['最小', min], ['半池', preset(.5)], ['满池', preset(1)]].map(([label, value]) => <button key={label} className={raise === value ? 'is-active' : ''} disabled={locked || !actions.canRaise} onClick={() => chooseRaise(value)}>{label}</button>)}</div>
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
  const layersRef = useRef({ confirmLeave: false, panel: '', rules: false, history: false });
  layersRef.current = { confirmLeave, panel, rules, history };
  useEffect(() => { if (game.serverTime) offset.current = game.serverTime - Date.now(); }, [game.serverTime]);
  useEffect(() => {
    unmounting.current = false;
    const old = document.activeElement;
    const el = dialog.current;
    if (el && !el.open) el.showModal();
    const onKeyDown = event => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const layers = layersRef.current;
      if (!layers.confirmLeave && !layers.panel && !layers.rules && !layers.history) return;
      event.preventDefault();
      event.stopPropagation();
      if (layers.confirmLeave) setConfirmLeave(false);
      else if (layers.panel) setPanel('');
      else if (layers.rules) setRules(false);
      else if (layers.history) setHistory(false);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      unmounting.current = true;
      window.removeEventListener('keydown', onKeyDown, true);
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
  const showTable = table && !browsing;
  const { enabled: sound, toggle: toggleSound, unlock: unlockSound, play: playSound, stop: stopSound } = usePokerAudio(Boolean(showTable), table?.id);
  const hasRecentSpeech = Boolean(showTable && table.messages?.some(message => Date.now() + offset.current - message.at < 6500));
  const needsTick = Boolean(showTable && (activeHand(table) || Boolean(table.nextHandAt) || hasRecentSpeech));
  useEffect(() => {
    if (!needsTick) return;
    setNow(Date.now() + offset.current);
    const timer = setInterval(() => setNow(Date.now() + offset.current), 250);
    return () => clearInterval(timer);
  }, [needsTick, table?.messages?.length, table?.handId, table?.phase, table?.nextHandAt]);
  useTableMotion(table, stage, Boolean(showTable), playSound, stopSound);
  const own = table?.players.find(player => player.id === me.id);
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
  return <dialog ref={dialog} className={`arcade-dialog ${nativeMac ? 'is-mac' : ''}`} aria-labelledby="arcade-title"
    onPointerDownCapture={unlockSound} onKeyDownCapture={unlockSound}
    onCancel={event => {
      event.preventDefault(); event.stopPropagation();
      if (confirmLeave) setConfirmLeave(false);
      else if (panel) setPanel('');
      else if (rules) setRules(false);
      else if (history) setHistory(false);
      else onClose();
    }}
    onClose={() => { if (!unmounting.current && !dialog.current?.open) onCloseRef.current(); }}>
    <div className="arcade-app">{nativeMac && <div className="arcade-window-chrome" data-drag-region aria-hidden="true" />}<header className="arcade-header"><button className="arcade-back" onClick={back} aria-label={showTable ? '返回德州大厅' : selectedGame ? '返回游戏列表' : '返回聊天'}><ArrowLeft size={19} /></button><div className="arcade-wordmark"><ArcadeIcon size={25} /><h1 id="arcade-title">游戏厅</h1><span>/</span><b>{showTable ? table.name : selectedGame ? '德州扑克' : '全部游戏'}</b></div><span className={`arcade-network ${connected ? '' : 'offline'}`}><i />{connected ? '在线' : '重连中'}</span><button className="arcade-close" onClick={onClose}><span>返回聊天</span><X size={18} /></button></header>
      {game.error && <div className="arcade-error" role="alert"><span>{game.error}</span><button onClick={game.refresh} aria-label="重新连接游戏厅"><RefreshCw size={16} /></button></div>}
      {!connected && <div className="arcade-disconnected" role="status">正在重新连接，行动暂不可用；恢复后自动同步牌局。</div>}
      {game.loading && !game.tables ? <div className="arcade-loading" role="status"><RefreshCw size={25} className="spin" /><p>正在连接游戏厅…</p></div> : !showTable ? <ArcadeLobby game={game} me={me} connected={connected} table={table} own={own} selectedGame={selectedGame} onSelect={setSelectedGame} onView={view} onReturn={() => setBrowsing(false)} onCommand={command} onPanel={setPanel} onRules={() => setRules(true)} roomIcon={<Suit suit="s" />} art={<><div className="feature-orbit" /><div className="hero-card card-one"><Card card="As" /></div><div className="hero-card card-two"><Card card="Ah" /></div><div className="hero-chip-stack"><Chips amount={500} /></div></>} /> : <main className="poker-room"><div className="poker-room-top"><div><span className="poker-live-dot" /><b>德州扑克</b><span>盲注 {table.smallBlind} / {table.bigBlind}</span><span>第 {table.matchNumber} 场 · {table.matchHandNumber}{table.handLimit ? ` / ${table.handLimit}` : ''} 手{!table.handLimit && ' · 不限'}</span></div><div className="poker-tools"><button onClick={() => setPanel('rank')} aria-label="排行榜"><Trophy size={17} /></button><button onClick={() => setPanel('wallet')} aria-label="我的筹码"><Coins size={17} /></button>{own && <button onClick={() => setPanel('invite')} aria-label="邀请好友进房"><UserPlus size={17} /></button>}<button onClick={toggleSound} aria-label={sound ? '关闭游戏声音' : '开启游戏声音'} aria-pressed={sound}>{sound ? <Volume2 size={17} /> : <VolumeX size={17} />}</button><button className="privacy-toggle-btn" onClick={togglePrivacy} aria-pressed={privacyMode} aria-label={privacyMode ? '关闭防窥模式（新局默认明牌）' : '开启防窥模式（新局默认盖牌）'} title={privacyMode ? '防窥模式已开启：新局自动盖牌，点击关闭并翻开当前底牌' : '开启防窥模式：立即盖住当前底牌，且新局自动盖牌'}>{privacyMode ? <EyeOff size={17} /> : <Eye size={17} />}</button><button onClick={() => setHistory(value => !value)} aria-label="本局记录" aria-pressed={history}><History size={17} /></button><button onClick={() => setRules(value => !value)} aria-label="玩法规则" aria-pressed={rules}><CircleHelp size={17} /></button>{own && <button className="leave-table" disabled={activeHand(table)} title={activeHand(table) ? '本局结束后可以离桌' : '离桌并退回筹码'} onClick={() => setConfirmLeave(true)}><LogOut size={16} /><span>离桌</span></button>}</div></div>
        <div className="poker-layout"><section ref={stage} className={`poker-stage ${table.phase === 'showdown' ? 'settled' : ''}`} aria-label="德州扑克牌桌"><div className="poker-ambient" /><div className="poker-felt"><TableEngraving /><div className="felt-stitch" /><div className="felt-label">虾扯蛋 <span>POKER CLUB</span></div><div className="board-area"><span className="street-label">{PHASE[table.phase]}</span><div className="pot-rack" data-pot-anchor><Chips unit={table.smallBlind} amount={table.phase === 'showdown' ? 0 : Math.max(0, table.pot - table.players.reduce((sum, player) => sum + player.bet, 0))} /></div><div className="poker-pot" key={`${table.handId}-${table.pot}`}><span>底池</span><strong>{number(table.pot)}</strong></div><div className="community-cards">{Array.from({ length: 5 }, (_, i) => table.board[i] ? <Card key={`${table.handId}-${i}`} card={table.board[i]} index={i} boardIndex={i} /> : <div className="card-placeholder" key={`empty-${i}`}><Suit suit={i % 2 ? 'h' : 's'} /></div>)}</div>{table.phase === 'waiting' && <p className="board-hint">入座，准备，开始一局。</p>}{table.phase === 'showdown' && winners.length > 0 && <div className="poker-result" role="status" key={table.handId}><strong>{winners.map(winner => table.players.find(player => player.id === winner.id)?.name || '玩家').join('、')} {winners.length > 1 ? '分享底池' : '赢得底池'}</strong><span>{table.result.reason === 'fold' ? '其他玩家弃牌' : [...new Set(winners.map(winner => winner.hand).filter(Boolean))].join(' · ')}</span></div>}</div></div>
          <DealerArm phase={table.phase} handId={table.handId} />
          <div className="poker-deck" data-deal-origin aria-hidden="true"><Card back small /><Card back small /></div>
          <div className="poker-scoreboard"><div><span>盲注 {table.smallBlind} / {table.bigBlind}</span><b>{table.matchComplete ? '本场结束' : PHASE[table.phase]}</b></div><div><span>底池总额</span><Counter value={table.pot} /><i className="street-lights">{[0, 1, 2, 3].map(i => <em key={i} className={['preflop', 'flop', 'turn', 'river', 'showdown'].indexOf(table.phase) >= i ? 'on' : ''} />)}</i></div></div>
          {Array.from({ length: 6 }, (_, position) => { const seat = (position + mySeat) % 6; const player = table.players.find(item => item.seat === seat); const isMine = player?.id === me.id; return <Seat key={seat} position={position} player={player} table={table} me={me} busy={game.busy || Boolean(own) || !connected} onJoin={() => command('join', { id: table.id, seat })} now={now} preview={wagerPreview?.handId === table.handId && wagerPreview?.seat === seat && table.actions?.canAct ? wagerPreview.amount : 0} coveredCards={isMine ? effectiveCovered : undefined} peekingCards={isMine ? effectivePeeking : undefined} onToggleCover={isMine ? toggleCardCover : undefined} onPeekChange={isMine ? setCardPeek : undefined} />; })}
          <div className="table-motion-layer" aria-hidden="true" /><span className="table-id">{table.id.slice(0, 8).toUpperCase()}</span>
        </section><aside className={`poker-ledger ${history ? 'show-ledger' : ''}`}><div className="ledger-heading"><h3>本局记录</h3><button className="mobile-ledger-close" onClick={() => setHistory(false)} aria-label="收起记录"><X size={17} /></button></div><div className="ledger-pot"><span>底池总额</span><strong>{number(table.pot)}</strong><small>{table.players.filter(player => player.inHand && !player.folded).length} 人仍在本局</small></div><ol>{[...(table.log || [])].reverse().slice(0, 20).map(entry => <li key={entry.id}><span>{entry.text}</span><time>{new Date(entry.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time></li>)}</ol>{table.result?.pots?.length > 1 && <div className="side-pots">{table.result.pots.map((pot, index) => <div key={index}><span>{index ? `边池 ${index}` : '主池'}</span><b>{number(pot.amount)}</b></div>)}</div>}<div className="ledger-footer">2–6 人 · 虚拟筹码</div></aside></div>
        <TableChat table={table} own={own} busy={game.busy || !connected} onCommand={command} /><Actions table={table} me={me} busy={game.busy} connected={connected} onCommand={command} wallet={game.wallet} onStakes={() => setPanel('stakes')} onPreview={setWagerPreview} now={now} />
      </main>}
      {panel === 'stakes' && table && <StakesPanel table={table} onCommand={command} error={game.error} onClose={() => setPanel('')} />}{panel === 'rank' && <Leaderboard me={me} onClose={() => setPanel('')} />}{panel === 'wallet' && <WalletPanel me={me} onClose={() => setPanel('')} onChanged={game.refresh} />}{panel === 'invite' && table && <InvitePanel table={table} error={game.error} onCommand={command} onClose={() => setPanel('')} />}{rules && <Rules onClose={() => setRules(false)} />}
      {confirmLeave && <div className="arcade-confirm"><div ref={confirmLeaveRef} role="alertdialog" aria-modal="true" aria-labelledby="leave-title"><h3 id="leave-title">离开牌桌？</h3><p>{activeHand(table) && own?.inHand ? own.allIn ? '你已全下，本局会继续结算，结束后可换桌。' : '之后自动过牌或弃牌，本局结束后可换桌。已投入的筹码留在底池。' : `离桌后，剩余 ${number(own?.stack)} 筹码会退回账户。`}</p><div><button className="arcade-secondary" onClick={() => setConfirmLeave(false)}>继续玩</button><button className="arcade-primary" disabled={game.busy} onClick={() => command('leave', { id: table.id })}>确认离桌</button></div></div></div>}
    </div>
  </dialog>;
}
