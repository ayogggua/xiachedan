import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, RotateCw, Sparkles } from 'lucide-react';
import { haptic } from '../chatPrefs';
import { CardOrnament, CardPips, SUITS, Suit } from './ArcadeCards';

const PEEL_THRESHOLD = 0.56;

function cardPoint(card) {
  if (!card) return 0;
  const r = card[0];
  if (r === 'A') return 1;
  if ('TJQK'.includes(r)) return 0;
  return Number(r);
}

function SqueezeCardFace({ card, hideCorners }) {
  const rank = card.slice(0, -1);
  const suit = card.slice(-1);
  const color = suit === 'h' || suit === 'd' ? 'red' : 'black';
  const label = rank === 'T' ? '10' : rank;
  return (
    <div className={`squeeze-face ${color} ${hideCorners ? 'is-masked' : ''}`}>
      <span className="squeeze-corner top">
        <b>{label}</b>
        <Suit suit={suit} />
      </span>
      <CardPips rank={rank} suit={suit} />
      <span className="squeeze-corner bottom">
        <b>{label}</b>
        <Suit suit={suit} />
      </span>
      {hideCorners && (
        <>
          <span className="squeeze-thumb-mask top" aria-hidden="true" />
          <span className="squeeze-thumb-mask bottom" aria-hidden="true" />
        </>
      )}
    </div>
  );
}

function InteractiveSqueezeCard({
  card,
  index,
  revealed,
  rotated,
  hideCorners,
  onReveal,
  onSound,
}) {
  const cardRef = useRef(null);
  const dragRef = useRef(null);
  const [peel, setPeel] = useState({ dir: 'up', progress: 0, dragging: false });
  const hapticHit = useRef(false);

  useEffect(() => {
    if (revealed) {
      dragRef.current = null;
      setPeel({ dir: 'up', progress: 0, dragging: false });
    }
  }, [revealed]);

  const computeDrag = (dx, dy, box) => {
    // 旋转 90°（顺时针）后将屏幕位移投影回牌面局部坐标系
    const localDx = rotated ? dy : dx;
    const localDy = rotated ? -dx : dy;
    const w = rotated ? box.height : box.width;
    const h = rotated ? box.width : box.height;
    const absX = Math.abs(localDx);
    const absY = Math.abs(localDy);
    if (absX < 5 && absY < 5) return null;
    let dir;
    let ratio;
    if (absY >= absX) {
      dir = localDy < 0 ? 'up' : 'down';
      ratio = absY / Math.max(80, h * 0.78);
    } else {
      dir = localDx < 0 ? 'left' : 'right';
      ratio = absX / Math.max(70, w * 0.78);
    }
    return { dir, progress: Math.max(0, Math.min(1, ratio)) };
  };

  const onPointerDown = event => {
    if (revealed) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch {}
    hapticHit.current = false;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startAt: performance.now(),
      box: cardRef.current.getBoundingClientRect(),
      lastProgress: 0,
      lastDir: 'up',
    };
  };

  const onPointerMove = event => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || revealed) return;
    event.preventDefault();
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    const next = computeDrag(dx, dy, drag.box);
    if (!next) return;
    drag.lastProgress = next.progress;
    drag.lastDir = next.dir;
    if (next.progress >= 0.34 && !hapticHit.current) {
      hapticHit.current = true;
      if (event.pointerType === 'touch') haptic();
    }
    setPeel({ dir: next.dir, progress: next.progress, dragging: true });
  };

  const finishDrag = (event, cancelled = false) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    try {
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {}
    if (revealed) return;
    const elapsed = Math.max(1, performance.now() - drag.startAt);
    const fastFlick = !cancelled && drag.lastProgress >= 0.3 && elapsed < 260;
    if (!cancelled && (drag.lastProgress >= PEEL_THRESHOLD || fastFlick)) {
      if (event.pointerType === 'touch') haptic();
      onSound?.('flip', { pan: index === 0 ? -0.15 : 0.15 });
      setPeel({ dir: drag.lastDir, progress: 1, dragging: false });
      onReveal(index);
    } else {
      setPeel(prev => ({ ...prev, progress: 0, dragging: false }));
    }
  };

  const pct = Math.round(peel.progress * 1000) / 10;
  const activePeel = !revealed && peel.progress > 0.01;
  const maskCorner = hideCorners && !revealed && peel.progress < 0.72;

  let faceClip = 'inset(100% 0 0 0)';
  let backClip = 'inset(0 0 0 0)';
  let curlStyle = {};
  let shadowStyle = {};
  const lipPct = Math.min(34, pct * 0.56);

  if (revealed) {
    faceClip = 'inset(0 0 0 0)';
    backClip = 'inset(100% 0 0 0)';
  } else if (activePeel) {
    if (peel.dir === 'up') {
      faceClip = `inset(${100 - pct}% 0 0 0)`;
      backClip = `inset(0 0 ${pct}% 0)`;
      curlStyle = { left: 0, right: 0, bottom: `${pct}%`, height: `${lipPct}%` };
      shadowStyle = { left: 0, right: 0, top: `${100 - pct}%`, height: `${Math.min(18, pct * 0.35 + 4)}%` };
    } else if (peel.dir === 'down') {
      faceClip = `inset(0 0 ${100 - pct}% 0)`;
      backClip = `inset(${pct}% 0 0 0)`;
      curlStyle = { left: 0, right: 0, top: `${pct}%`, height: `${lipPct}%` };
      shadowStyle = { left: 0, right: 0, bottom: `${100 - pct}%`, height: `${Math.min(18, pct * 0.35 + 4)}%` };
    } else if (peel.dir === 'left') {
      faceClip = `inset(0 0 0 ${100 - pct}%)`;
      backClip = `inset(0 ${pct}% 0 0)`;
      curlStyle = { top: 0, bottom: 0, right: `${pct}%`, width: `${lipPct}%` };
      shadowStyle = { top: 0, bottom: 0, left: `${100 - pct}%`, width: `${Math.min(18, pct * 0.35 + 4)}%` };
    } else {
      faceClip = `inset(0 ${100 - pct}% 0 0)`;
      backClip = `inset(0 0 0 ${pct}%)`;
      curlStyle = { top: 0, bottom: 0, left: `${pct}%`, width: `${lipPct}%` };
      shadowStyle = { top: 0, bottom: 0, right: `${100 - pct}%`, width: `${Math.min(18, pct * 0.35 + 4)}%` };
    }
  }

  const rank = card.slice(0, -1);
  const suit = card.slice(-1);
  const faceAria = `${SUITS[suit]} ${rank === 'T' ? '10' : rank}`;

  return (
    <div className={`squeeze-card-slot ${rotated ? 'is-rotated' : ''} ${revealed ? 'is-open' : ''}`}>
      <div
        ref={cardRef}
        className={`squeeze-card ${peel.dragging ? 'is-dragging' : ''} ${revealed ? 'is-revealed' : ''} ${rotated ? 'is-rotated' : ''}`}
        role="group"
        aria-label={revealed ? faceAria : `第 ${index + 1} 张未亮牌，按住拖动边角咪牌`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={event => finishDrag(event, false)}
        onPointerCancel={event => finishDrag(event, true)}
        onLostPointerCapture={event => finishDrag(event, true)}
        onContextMenu={event => event.preventDefault()}
      >
        <div className="squeeze-card-inner">
          <div className="squeeze-layer squeeze-layer-face" style={{ clipPath: faceClip }}>
            <SqueezeCardFace card={card} hideCorners={maskCorner} />
          </div>
          {!revealed && (
            <div className="squeeze-layer squeeze-layer-back" style={{ clipPath: backClip }}>
              <CardOrnament />
              {!activePeel && (
                <span className="squeeze-drag-cue" aria-hidden="true">
                  <i />
                  <b>拖动边角咪牌</b>
                </span>
              )}
            </div>
          )}
          {activePeel && (
            <>
              <div className={`squeeze-cast-shadow dir-${peel.dir}`} style={shadowStyle} aria-hidden="true" />
              <div className={`squeeze-curl-lip dir-${peel.dir}`} style={curlStyle} aria-hidden="true" />
            </>
          )}
        </div>
      </div>
      <div className="squeeze-slot-bar">
        {revealed ? (
          <span className="squeeze-slot-revealed">
            <b>{rank === 'T' ? '10' : rank}</b>
            <Suit suit={suit} className={suit === 'h' || suit === 'd' ? 'is-red' : ''} />
            <small>{cardPoint(card)} 点</small>
          </span>
        ) : (
          <button
            type="button"
            className="squeeze-flip-one"
            onClick={() => {
              onSound?.('flip', { pan: index === 0 ? -0.15 : 0.15 });
              onReveal(index);
            }}
          >
            直接翻开
          </button>
        )}
      </div>
    </div>
  );
}

export default function BaccaratSqueeze({
  squeeze,
  roundId,
  existingCards = [],
  opponentLabel = '',
  opponentPoints = null,
  now,
  busy,
  onComplete,
  onSound,
}) {
  const cards = squeeze?.cards || [];
  const stepKey = `${roundId}:${squeeze?.step}`;
  const [revealedFlags, setRevealedFlags] = useState(() => cards.map(() => false));
  const [rotated, setRotated] = useState(false);
  const [hideCorners, setHideCorners] = useState(true);
  const submittedRef = useRef('');

  useEffect(() => {
    setRevealedFlags(cards.map(() => false));
    submittedRef.current = '';
    // 补第 3 张牌默认横咪，贴合澳门横牌节奏
    setRotated(Boolean(squeeze?.isThirdCard));
  }, [stepKey, cards.length, squeeze?.isThirdCard]);

  const commit = useCallback(() => {
    if (submittedRef.current === stepKey) return;
    submittedRef.current = stepKey;
    onComplete(squeeze.step);
  }, [onComplete, squeeze?.step, stepKey]);

  const allRevealed = cards.length > 0 && revealedFlags.length === cards.length && revealedFlags.every(Boolean);

  useEffect(() => {
    if (!allRevealed || submittedRef.current === stepKey) return;
    const timer = setTimeout(commit, 520);
    return () => clearTimeout(timer);
  }, [allRevealed, commit, stepKey]);

  const revealIndex = useCallback(index => {
    setRevealedFlags(prev => prev.map((flag, i) => (i === index ? true : flag)));
  }, []);

  const revealAll = () => {
    if (busy) return;
    onSound?.('flip', { pan: 0 });
    setRevealedFlags(cards.map(() => true));
    setTimeout(commit, 220);
  };

  if (!squeeze || !squeeze.isMine || !cards.length) return null;

  const isBanker = squeeze.side === 'banker';
  const remaining = Math.max(0, Math.ceil(((squeeze.endsAt || now) - now) / 1000));
  const revealedCards = [...existingCards, ...cards.filter((_, i) => revealedFlags[i])];
  const currentPts = revealedCards.length
    ? revealedCards.reduce((sum, c) => sum + cardPoint(c), 0) % 10
    : null;
  const isNatural = !squeeze.isThirdCard && allRevealed && currentPts >= 8;

  return (
    <div className={`baccarat-squeeze-backdrop ${isBanker ? 'is-banker' : 'is-player'}`} role="dialog" aria-label="咪牌台">
      <div className="baccarat-squeeze-stage">
        <header className="squeeze-header">
          <div className="squeeze-title-group">
            <span className={`squeeze-side-pill ${isBanker ? 'banker' : 'player'}`}>
              {isBanker ? '咪庄牌' : '咪闲牌'}
            </span>
            <div className="squeeze-meta">
              <strong>{squeeze.isThirdCard ? '第 3 张补牌' : '前两张底牌'}</strong>
              <span>
                {opponentPoints !== null
                  ? `${opponentLabel}已亮 ${opponentPoints} 点`
                  : existingCards.length
                    ? `前两张 ${existingCards.reduce((s, c) => s + cardPoint(c), 0) % 10} 点`
                    : '按住牌面任意边角拖动，慢咪看边'}
              </span>
            </div>
          </div>
          <div className="squeeze-header-right">
            <span className={`squeeze-timer ${remaining <= 4 ? 'is-urgent' : ''}`}>{remaining}s</span>
          </div>
        </header>

        {existingCards.length > 0 && (
          <div className="squeeze-existing-row">
            <span>已亮底牌</span>
            <div className="squeeze-mini-cards">
              {existingCards.map((c, idx) => {
                const r = c.slice(0, -1);
                const s = c.slice(-1);
                return (
                  <span key={idx} className={`squeeze-mini-chip ${s === 'h' || s === 'd' ? 'is-red' : ''}`}>
                    <b>{r === 'T' ? '10' : r}</b>
                    <Suit suit={s} />
                  </span>
                );
              })}
              <small>合计 {existingCards.reduce((sum, c) => sum + cardPoint(c), 0) % 10} 点</small>
            </div>
          </div>
        )}

        <div className={`squeeze-cards-arena ${cards.length === 1 ? 'is-single' : 'is-pair'} ${rotated ? 'is-rotated' : ''}`}>
          {cards.map((card, idx) => (
            <InteractiveSqueezeCard
              key={`${stepKey}-${idx}`}
              card={card}
              index={idx}
              revealed={Boolean(revealedFlags[idx])}
              rotated={rotated}
              hideCorners={hideCorners}
              onReveal={revealIndex}
              onSound={onSound}
            />
          ))}
        </div>

        <footer className="squeeze-footer">
          <div className="squeeze-tools">
            <button
              type="button"
              className={`squeeze-tool-btn ${rotated ? 'is-active' : ''}`}
              onClick={() => setRotated(v => !v)}
            >
              <RotateCw size={15} />
              <span>{rotated ? '切回直咪' : '旋转横咪'}</span>
            </button>
            <button
              type="button"
              className={`squeeze-tool-btn ${hideCorners ? 'is-active' : ''}`}
              onClick={() => setHideCorners(v => !v)}
              title="遮住角标，先凭花色边点猜牌"
            >
              {hideCorners ? <EyeOff size={15} /> : <Eye size={15} />}
              <span>{hideCorners ? '遮角看边' : '显示角标'}</span>
            </button>
          </div>
          <div className="squeeze-footer-right">
            {currentPts !== null && (
              <span className={`squeeze-live-pts ${isNatural ? 'is-natural' : ''}`}>
                {isNatural && <Sparkles size={14} />}
                {isBanker ? '庄' : '闲'} {currentPts} 点{isNatural ? ' · 例牌' : ''}
              </span>
            )}
            <button
              type="button"
              className="arcade-primary squeeze-reveal-all"
              disabled={busy || allRevealed}
              onClick={revealAll}
            >
              {allRevealed ? '正在亮牌…' : '一键亮牌'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
