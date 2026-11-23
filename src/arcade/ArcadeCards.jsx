import React, { memo, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { EyeOff } from 'lucide-react';
import { haptic } from '../chatPrefs';
import { paintChipPile } from './pokerChips';
import { CardOrnament as BackDrawing } from './ArcadeDecor';

export const SUITS = { s: '黑桃', h: '红桃', d: '方块', c: '梅花' };
const PEEK_DELAY_MS = 220;
const PEEK_DRAG_LIMIT = 18;
const formatNumber = value => new Intl.NumberFormat('zh-CN').format(value || 0);
export const CardOrnament = memo(BackDrawing);

export function Suit({ suit = 's', ...props }) {
  const paths = {
    s: 'M12 2C9 6 3 9 3 14a5 5 0 0 0 8 4l-2 4h6l-2-4a5 5 0 0 0 8-4c0-5-6-8-9-12Z',
    h: 'M12 21 3 12C-3 4 8-2 12 6 16-2 27 4 21 12Z',
    d: 'M12 1 22 12 12 23 2 12Z',
    c: 'M10 16a5 5 0 1 1-3-8 5 5 0 1 1 10 0 5 5 0 1 1-3 8l2 6H8Z',
  };
  return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}><path d={paths[suit]} /></svg>;
}

export function Counter({ value }) {
  const text = formatNumber(value);
  return <strong className="mechanical-counter" aria-label={text}>{text.split('').map((char, i) => <span key={text.length - i} className={char === ',' ? 'counter-sep' : 'counter-digit'}><b key={char}>{char}</b></span>)}</strong>;
}

export function CardPips({ rank, suit }) {
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

export const Card = memo(function Card({ card, back = false, index = 0, boardIndex, small = false, winner = false, coverable = false, covered = false, peeking = false, onToggleCover, onPeekChange, className = '' }) {
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
        if (event.pointerType === 'touch') haptic();
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
    : back ? '未公开的牌' : faceLabel;
  const title = coverable ? (back ? '点击翻开，长按偷看' : peeking ? '松手自动盖回' : '点击盖牌防窥') : undefined;

  return <div data-card-index={index} data-board-index={boardIndex}
    data-covered={coverable ? (covered ? 'true' : 'false') : undefined}
    data-peeking={coverable ? (peeking ? 'true' : 'false') : undefined}
    role={coverable ? 'button' : undefined}
    tabIndex={coverable ? 0 : undefined}
    aria-pressed={coverable ? covered : undefined}
    aria-label={ariaLabel}
    title={title}
    className={`poker-card ${back ? 'back' : color} ${small ? 'small' : ''} ${winner && !back ? 'winning' : ''} ${coverable ? 'is-coverable' : ''} ${coverable && covered ? 'is-covered' : ''} ${coverable && peeking ? 'is-peeking' : ''} ${className}`}
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

export const Chips = memo(function Chips({ amount = 0, unit = 1, className = '' }) {
  const canvas = useRef(null);
  useLayoutEffect(() => { paintChipPile(canvas.current, amount, unit); }, [amount, unit]);
  return <span className={`poker-chips ${className}`} data-chip-amount={amount} data-chip-unit={unit} aria-hidden="true"><canvas ref={canvas} className="poker-chip-pile" /></span>;
});
