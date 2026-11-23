import React, { memo, useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  Check, CircleHelp, Coins, Hand, History, MessageSquare,
  Play, RefreshCw, RotateCcw, Send, Trash2, Trophy, UserPlus, Volume2, VolumeX, X, Zap,
} from 'lucide-react';
import { Avatar } from '../components';
import { haptic } from '../chatPrefs';
import { Card, Chips, Counter } from './ArcadeCards';
import { DealerArm as DealerDrawing } from './ArcadeDecor';
import { Sheet } from './ArcadePanels';
import BaccaratRoadmap from './BaccaratRoadmap';
import BaccaratSqueeze from './BaccaratSqueeze';

const DealerArm = memo(DealerDrawing);

const number = value => new Intl.NumberFormat('zh-CN').format(value || 0);
const signed = value => `${value > 0 ? '+' : ''}${number(value)}`;
const shortChip = value => {
  if (value >= 10000 && value % 10000 === 0) return `${value / 10000}万`;
  if (value >= 1000 && value % 1000 === 0) return `${value / 1000}K`;
  return String(value);
};

const QUICK_PHRASES = ['顺风顺水', '长龙来了', '吹！顶！', '例牌带走', '跟一手', '稳住'];
const OUTCOME_TEXT = { banker: '庄赢', player: '闲赢', tie: '和局' };
const CHIP_PALETTES = ['ivory', 'crimson', 'sapphire', 'emerald', 'amethyst', 'obsidian'];

function BaccaratEngraving() {
  const id = `bac-felt-${useId().replace(/:/g, '')}`;
  return (
    <svg className="baccarat-table-engraving" viewBox="0 0 1000 540" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-gold`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f2da9a" stopOpacity="0.52" />
          <stop offset="50%" stopColor="#caa558" stopOpacity="0.34" />
          <stop offset="100%" stopColor="#f2da9a" stopOpacity="0.52" />
        </linearGradient>
        <radialGradient id={`${id}-spot`} cx="50%" cy="32%" r="62%">
          <stop offset="0%" stopColor="#2e8e68" stopOpacity="0.22" />
          <stop offset="60%" stopColor="#123f2e" stopOpacity="0" />
          <stop offset="100%" stopColor="#05130d" stopOpacity="0.5" />
        </radialGradient>
      </defs>
      <rect x="0" y="0" width="1000" height="540" fill={`url(#${id}-spot)`} />
      <rect x="18" y="18" width="964" height="504" rx="164" fill="none" stroke={`url(#${id}-gold)`} strokeWidth="1.25" />
      <rect x="27" y="27" width="946" height="486" rx="156" fill="none" stroke="#dcc07a" strokeWidth="0.65" strokeOpacity="0.28" strokeDasharray="3 5" />
      <path d="M120 264 Q500 226 880 264" fill="none" stroke={`url(#${id}-gold)`} strokeWidth="1.1" strokeOpacity="0.6" />
      <path d="M120 272 Q500 234 880 272" fill="none" stroke="#e4c680" strokeWidth="0.55" strokeOpacity="0.26" />
      <line x1="500" y1="42" x2="500" y2="236" stroke="#e2c57f" strokeWidth="0.8" strokeOpacity="0.24" strokeDasharray="3 4" />
      <path d="M500 238 L506 245 L500 252 L494 245 Z" fill="#e2c57f" fillOpacity="0.44" />
    </svg>
  );
}

export function BaccaratRules({ onClose, mobile = false }) {
  const body = (
    <div className="baccarat-rules-body">
      <section>
        <h4>牌靴与点数</h4>
        <p>采用标准 8 副扑克牌（416 张，不含大小王），系统担任荷官自动发牌。新靴开局翻开首牌并按其点数销牌（A 销 1 张，2–9 按面值，10/J/Q/K 销 10 张）；剩牌触及切牌位（14 张）时，本局结束后自动换新靴并重置路单。</p>
        <p>A 计 1 点，2–9 按牌面计点，10/J/Q/K 计 0 点；总点数仅取个位数，最大为 9 点，最小为 0 点。</p>
      </section>
      <section>
        <h4>澳门标准补牌规则</h4>
        <p>按「闲 1 → 庄 1 → 闲 2 → 庄 2」发牌。若任一方前两张合计 8 或 9 点（例牌/天牌），双方均不补牌直接比大小。</p>
        <p>非例牌时先判闲家：0–5 点补第 3 张牌，6–7 点不补。再判庄家：若闲家未补牌，庄家 0–5 点补牌、6–7 点不补；若闲家补牌，按闲家第 3 张牌点数判定：</p>
        <table className="baccarat-rules-table">
          <thead><tr><th>庄前两张</th><th>闲第 3 张点数（补牌）</th><th>闲第 3 张点数（不补）</th></tr></thead>
          <tbody>
            <tr><td>0 – 2 点</td><td>全部补牌</td><td>—</td></tr>
            <tr><td>3 点</td><td>0, 1, 2, 3, 4, 5, 6, 7, 9</td><td>8</td></tr>
            <tr><td>4 点</td><td>2, 3, 4, 5, 6, 7</td><td>0, 1, 8, 9</td></tr>
            <tr><td>5 点</td><td>4, 5, 6, 7</td><td>0, 1, 2, 3, 8, 9</td></tr>
            <tr><td>6 点</td><td>6, 7</td><td>0, 1, 2, 3, 4, 5, 8, 9</td></tr>
            <tr><td>7 点</td><td>—</td><td>全部不补</td></tr>
          </tbody>
        </table>
      </section>
      <section>
        <h4>赔率与和局退本</h4>
        <p><strong>免佣台（含幸运 6）</strong>：闲赢 1:1；庄赢 1:1，若庄以 6 点胜出赔 1:0.5；和 1:8；庄对 / 闲对（前两张同牌面）1:11；幸运 6（庄 6 点胜）两张牌 1:12、三张牌 1:20。</p>
        <p><strong>传统抽水台</strong>：闲赢 1:1；庄赢 1:0.95（抽 5% 佣金）；和 1:8；庄对 / 闲对 1:11。</p>
        <p>开和时，押注「庄」与「闲」的本金全额退回，不计输赢；同局不可同时押庄和闲。</p>
      </section>
      <section>
        <h4>咪牌与通用筹码</h4>
        <p>遵循澳门贵宾厅习惯：押闲最高注者负责咪闲牌，押庄最高注者负责咪庄牌；支持拖动任意边角慢咪、90° 旋转横咪与遮角看边，也可随时切换为快速开牌。</p>
        <p>下注直接扣除游戏厅通用总账户余额，结算后实时派彩回总账户；未开牌前可随时撤销或清空注单。</p>
      </section>
    </div>
  );
  if (mobile) return <Sheet title="澳门百家乐规则" icon={<CircleHelp size={20} />} onClose={onClose} wide>{body}</Sheet>;
  return (
    <div className="arcade-popover baccarat-rules-popover" role="region" aria-label="澳门百家乐规则">
      <div><h3>澳门百家乐规则</h3><button onClick={onClose} aria-label="收起规则"><X size={18} /></button></div>
      {body}
    </div>
  );
}

function BaccaratChat({ table, busy, onCommand, mobile, open, onClose }) {
  const [text, setText] = useState('');
  const listRef = useRef(null);
  useEffect(() => {
    if (open) listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [table.messages?.length, open]);

  const sendText = async content => {
    const trimmed = content.trim();
    if (!trimmed || busy) return;
    if (await onCommand('say', { id: table.id, text: trimmed })) setText('');
  };

  if (!open) return null;
  const content = (
    <div className="mobile-poker-chat baccarat-chat-body">
      <ol className="mobile-poker-chat-list" ref={listRef}>
        {table.messages?.length
          ? table.messages.map(msg => (
            <li key={msg.id}>
              <b>{msg.name}</b>
              <p>{msg.text}</p>
              <time>{new Date(msg.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time>
            </li>
          ))
          : <li className="empty">还没有牌桌消息</li>}
      </ol>
      <div className="poker-quick-phrases" role="group" aria-label="快捷短语">
        {QUICK_PHRASES.map(phrase => (
          <button key={phrase} type="button" disabled={busy} onClick={() => sendText(phrase)}>{phrase}</button>
        ))}
      </div>
      <form className="mobile-poker-chat-form" onSubmit={e => { e.preventDefault(); sendText(text); }}>
        <input
          aria-label="牌桌聊天消息"
          maxLength={160}
          placeholder="和同桌玩家聊两句…"
          value={text}
          disabled={busy}
          onChange={e => setText(e.target.value)}
        />
        <button type="submit" aria-label="发送牌桌消息" disabled={busy || !text.trim()}><Send size={17} /></button>
      </form>
    </div>
  );
  return <Sheet title="牌桌聊天" icon={<MessageSquare size={19} />} onClose={onClose}>{content}</Sheet>;
}

export default function BaccaratRoom({
  table,
  wallet,
  me,
  connected,
  busy,
  now,
  mobile,
  sound,
  onToggleSound,
  playSound,
  onCommand,
  onPanel,
  onRules,
  chatOpen,
  onChatOpen,
  historyOpen,
  onHistoryOpen,
  unreadChat = 0,
}) {
  const [selectedChip, setSelectedChip] = useState(() => table.chips?.[1] || table.chips?.[0] || 10);
  const [roadmapExpanded, setRoadmapExpanded] = useState(false);

  // 切换不同限红牌桌时同步默认筹码面额
  useEffect(() => {
    if (table.chips?.length && !table.chips.includes(selectedChip)) {
      setSelectedChip(table.chips[1] || table.chips[0]);
    }
  }, [table.id, table.chips, selectedChip]);

  // 牌面翻开 & 结算音效同步
  const prevStateRef = useRef({ roundId: table.roundId, pCount: 0, bCount: 0, phase: table.phase });
  useEffect(() => {
    const prev = prevStateRef.current;
    const pCount = table.playerCards?.length || 0;
    const bCount = table.bankerCards?.length || 0;
    if (prev.roundId !== table.roundId) {
      prevStateRef.current = { roundId: table.roundId, pCount, bCount, phase: table.phase };
      return;
    }
    if (pCount > prev.pCount) playSound?.('card-land', { pan: -0.25 });
    if (bCount > prev.bCount) playSound?.('card-land', { pan: 0.25 });
    if (prev.phase !== 'settled' && table.phase === 'settled') {
      if (table.myResult) {
        if (table.myResult.net > 0) playSound?.('payout-self', { progress: 0.8 });
        else if (table.myResult.net < 0) playSound?.('collect', { count: 2 });
        else playSound?.('check');
      } else if (table.result?.totalPayout > 0) {
        playSound?.('payout-other', { progress: 0.6 });
      }
    }
    prevStateRef.current = { roundId: table.roundId, pCount, bCount, phase: table.phase };
  }, [table.roundId, table.phase, table.playerCards?.length, table.bankerCards?.length, table.myResult, table.result?.totalPayout, playSound]);

  const locked = !connected;
  const canBet = ['open', 'betting'].includes(table.phase) && !locked;
  const balance = wallet?.balance ?? 0;

  const chipIndex = Math.max(0, (table.chips || []).indexOf(selectedChip));
  const placeBet = useCallback(spot => {
    if (!canBet) return;
    if (mobile) haptic();
    playSound?.('bet', { level: Math.min(8, chipIndex + 2), pan: spot === 'player' || spot === 'playerPair' ? -0.25 : spot === 'banker' || spot === 'bankerPair' ? 0.25 : 0 });
    onCommand('bet', { id: table.id, spot, amount: selectedChip });
  }, [canBet, mobile, playSound, chipIndex, onCommand, table.id, selectedChip]);

  const completeSqueeze = useCallback(step => {
    onCommand('reveal', { id: table.id, roundId: table.roundId, step });
  }, [onCommand, table.id, table.roundId]);

  const bettingRemain = table.phase === 'betting' && table.bettingEndsAt
    ? Math.max(0, Math.ceil((table.bettingEndsAt - now) / 1000))
    : null;
  const bettingPct = table.phase === 'betting' && table.bettingEndsAt && table.bettingMs
    ? Math.max(0, Math.min(100, ((table.bettingEndsAt - now) / table.bettingMs) * 100))
    : 0;

  const winningSet = new Set(table.result?.winningSpots || []);
  const settled = table.phase === 'settled';
  const dealing = table.phase === 'dealing';
  const squeeze = table.squeeze;
  const squeezeRemain = squeeze?.endsAt ? Math.max(0, Math.ceil((squeeze.endsAt - now) / 1000)) : 0;

  const myBets = table.myBets || {};
  const isOpposingDisabled = spot => (spot === 'banker' && (myBets.player || 0) > 0) || (spot === 'player' && (myBets.banker || 0) > 0);
  const lowCards = table.cardsRemaining <= table.cutAt + 12;

  const spotDefs = [
    { id: 'playerPair', name: '闲对', en: 'PLAYER PAIR', odds: mobile ? '1:11' : '1 : 11', group: 'side', tone: 'player' },
    { id: 'tie', name: '和', en: 'TIE', odds: mobile ? '1:8' : '1 : 8', group: 'side', tone: 'tie' },
    ...(table.mode === 'no-commission'
      ? [{ id: 'lucky6', name: '幸运6', en: 'LUCKY 6', odds: mobile ? '1:12/20' : '1 : 12 / 20', group: 'side', tone: 'gold' }]
      : []),
    { id: 'bankerPair', name: '庄对', en: 'BANKER PAIR', odds: mobile ? '1:11' : '1 : 11', group: 'side', tone: 'banker' },
  ];
  const mainDefs = [
    { id: 'player', name: '闲', en: 'PLAYER', odds: mobile ? '1:1' : '1 : 1', tone: 'player' },
    {
      id: 'banker',
      name: '庄',
      en: 'BANKER',
      odds: table.mode === 'no-commission'
        ? (mobile ? '免佣 · 6点1:0.5' : '免佣 1 : 1（6点 1:0.5）')
        : (mobile ? '抽水 1:0.95' : '1 : 0.95'),
      tone: 'banker',
    },
  ];

  const renderSpotButton = def => {
    const info = table.spots?.[def.id] || { total: 0, count: 0, mine: 0 };
    const isWin = settled && winningSet.has(def.id);
    const isPush = settled && table.result?.outcome === 'tie' && (def.id === 'banker' || def.id === 'player') && info.total > 0;
    const opposing = isOpposingDisabled(def.id);
    const disabled = !canBet || opposing;
    return (
      <button
        key={def.id}
        type="button"
        disabled={disabled}
        title={opposing ? '同局不可同时押庄和闲' : `${def.name} · 赔率 ${def.odds}`}
        className={`baccarat-spot tone-${def.tone} ${def.group === 'side' ? 'is-side' : 'is-main'} ${info.mine > 0 ? 'has-mine' : ''} ${isWin ? 'is-winner' : ''} ${isPush ? 'is-push' : ''} ${opposing ? 'is-opposing' : ''}`}
        onClick={() => placeBet(def.id)}
      >
        <div className="spot-head">
          <strong className="spot-name">{def.name}</strong>
          <span className="spot-odds">{def.odds}</span>
        </div>
        <span className="spot-en" aria-hidden="true">{def.en}</span>
        <div className="spot-chips-area">
          {info.total > 0 && <Chips amount={info.total} unit={table.step} className="baccarat-spot-chips" />}
        </div>
        <div className="spot-foot">
          {info.mine > 0 ? (
            <span className="spot-my-bet">我 {number(info.mine)}</span>
          ) : (
            <span className="spot-my-placeholder">{opposing ? '已押对家' : canBet ? '点击落注' : ''}</span>
          )}
          {info.total > 0 && (
            <span className="spot-table-bet">总 {number(info.total)} · {info.count}人</span>
          )}
        </div>
        {isWin && <span className="spot-result-tag is-win">中奖</span>}
        {isPush && <span className="spot-result-tag is-push">退本</span>}
      </button>
    );
  };

  const renderCardSide = side => {
    const isBanker = side === 'banker';
    const cards = isBanker ? (table.bankerCards || []) : (table.playerCards || []);
    const slots = Math.max(2, isBanker ? (table.bankerCardSlots || 0) : (table.playerCardSlots || 0));
    const points = isBanker ? table.bankerPoints : table.playerPoints;
    const sideWon = settled && table.result?.outcome === side;
    const isNatural = settled && table.result?.natural && (isBanker ? table.result.bankerPoints >= 8 : table.result.playerPoints >= 8);
    const squeezingThis = dealing && squeeze?.side === side;
    const showDealSlots = dealing || settled;

    return (
      <div className={`duel-side side-${side} ${sideWon ? 'is-winner' : ''} ${squeezingThis ? 'is-squeezing' : ''}`}>
        <div className="duel-side-head">
          <span className="duel-side-label">
            <b>{isBanker ? '庄' : '闲'}</b>
            <small>{isBanker ? 'BANKER' : 'PLAYER'}</small>
          </span>
          <span className={`duel-points ${points !== null ? 'has-val' : ''} ${sideWon ? 'is-winner' : ''} ${isNatural ? 'is-natural' : ''}`}>
            {points !== null ? points : '—'}
          </span>
        </div>
        <div className={`duel-cards ${slots === 3 ? 'has-third' : ''}`}>
          {showDealSlots ? Array.from({ length: slots }, (_, idx) => {
            const code = cards[idx];
            const isThird = idx === 2;
            return (
              <div key={`${table.roundId}-${side}-${idx}`} className={`duel-card-wrap ${isThird ? 'is-third-card' : ''} ${!code ? 'is-facedown' : ''}`}>
                <Card
                  card={code}
                  back={!code}
                  index={idx}
                  winner={sideWon && Boolean(code)}
                />
              </div>
            );
          }) : (
            <>
              <div className="duel-card-empty" />
              <div className="duel-card-empty" />
            </>
          )}
        </div>
        {squeezingThis && (
          <span className="duel-squeeze-badge">
            <Hand size={12} />
            {squeeze.isMine ? '等待你咪牌' : `${squeeze.userName} 咪牌中`}
          </span>
        )}
      </div>
    );
  };

  const recentSpeech = table.messages?.findLast(m => now - m.at < 6000);
  const squeezeExisting = squeeze?.isMine
    ? (squeeze.side === 'banker' ? table.bankerCards : table.playerCards) || []
    : [];
  const squeezeOppSide = squeeze?.side === 'banker' ? 'player' : 'banker';
  const squeezeOppPts = squeeze?.isMine
    ? (squeezeOppSide === 'banker' ? table.bankerPoints : table.playerPoints)
    : null;

  return (
    <main className="baccarat-room">
      {!mobile && (
        <div className="poker-room-top baccarat-room-top">
          <div className="baccarat-room-meta">
            <span className="poker-live-dot" />
            <b>{table.name}</b>
            <span className="baccarat-mode-badge">{table.mode === 'no-commission' ? '免佣 · 幸运6' : '传统抽水 5%'}</span>
            <span>限红 {number(table.minBet)} – {number(table.maxBet)}</span>
            <span className={lowCards ? 'is-low-shoe' : ''}>
              第 {table.shoeNumber} 靴 · 第 {table.roundNumber} 局 · 剩 {table.cardsRemaining} 张{lowCards ? '（即将换靴）' : ''}
            </span>
          </div>
          <div className="poker-tools">
            <button
              type="button"
              className={`baccarat-squeeze-toggle ${table.mySqueezeEnabled ? 'is-on' : ''}`}
              disabled={locked}
              aria-pressed={table.mySqueezeEnabled}
              title={table.mySqueezeEnabled ? '咪牌已开启：最高注时可手动咪牌' : '快速开牌：由系统自动翻牌'}
              onClick={() => onCommand('squeeze', { id: table.id, enabled: !table.mySqueezeEnabled })}
            >
              {table.mySqueezeEnabled ? <Hand size={15} /> : <Zap size={15} />}
              <span>{table.mySqueezeEnabled ? '咪牌开' : '极速开'}</span>
            </button>
            <button type="button" onClick={() => onPanel('rank')} aria-label="排行榜"><Trophy size={17} /></button>
            <button type="button" className="baccarat-wallet-pill" onClick={() => onPanel('wallet')} aria-label="我的筹码">
              <Coins size={16} />
              <b>{number(balance)}</b>
            </button>
            <button type="button" onClick={() => onPanel('invite')} aria-label="邀请好友"><UserPlus size={17} /></button>
            <button type="button" onClick={onToggleSound} aria-label={sound ? '关闭声音' : '开启声音'} aria-pressed={sound}>
              {sound ? <Volume2 size={17} /> : <VolumeX size={17} />}
            </button>
            <button type="button" className="baccarat-chat-btn" onClick={() => onChatOpen(v => !v)} aria-label="牌桌聊天" aria-pressed={chatOpen}>
              <MessageSquare size={17} />
              {unreadChat > 0 && <span className="baccarat-badge">{unreadChat > 99 ? '99+' : unreadChat}</span>}
            </button>
            <button type="button" onClick={() => onHistoryOpen(v => !v)} aria-label="本靴记录" aria-pressed={historyOpen}><History size={17} /></button>
            <button type="button" onClick={onRules} aria-label="玩法规则"><CircleHelp size={17} /></button>
          </div>
        </div>
      )}

      <div className="baccarat-workspace">
        <section className={`baccarat-stage phase-${table.phase}`} aria-label="澳门百家乐牌桌">
          <div className="baccarat-felt">
            <BaccaratEngraving />
            <div className="baccarat-felt-rim" aria-hidden="true" />
            <DealerArm phase={dealing ? 'flop' : 'waiting'} handId={table.roundId} className="baccarat-shoe" />

            <div className="baccarat-stage-top">
              <div className="baccarat-shoe-meter" title={`第 ${table.shoeNumber} 靴 · 剩余 ${table.cardsRemaining} / ${table.shoeTotal} 张`}>
                <span>第 {table.shoeNumber} 靴</span>
                <div className="shoe-bar"><i style={{ width: `${Math.round((table.cardsRemaining / table.shoeTotal) * 100)}%` }} /></div>
                <b>{table.cardsRemaining} 张</b>
              </div>

              <div className={`baccarat-phase-banner phase-${table.phase}`} role="status">
                {table.phase === 'open' && (
                  <>
                    <strong>开放下注</strong>
                    <span>随时上桌 · 点击注区即可落注</span>
                  </>
                )}
                {table.phase === 'betting' && (
                  <>
                    <div className="betting-timer-row">
                      <strong>下注中</strong>
                      <b className={`betting-sec ${bettingRemain <= 4 ? 'is-urgent' : ''}`}>{bettingRemain}s</b>
                      <span>全桌总注 {number(table.tableTotalBet)}</span>
                    </div>
                    <div className="betting-progress"><i style={{ width: `${bettingPct}%` }} /></div>
                  </>
                )}
                {table.phase === 'dealing' && (
                  <>
                    <strong>{squeeze ? `${squeeze.userName} 正在咪${squeeze.side === 'banker' ? '庄' : '闲'}牌` : '买定离手 · 系统派牌'}</strong>
                    <span>{squeeze ? `剩余 ${squeezeRemain}s` : '依澳门规则逐张开牌'}</span>
                  </>
                )}
                {table.phase === 'settled' && table.result && (
                  <div className={`settled-banner outcome-${table.result.outcome}`}>
                    <div className="settled-headline">
                      <strong>
                        {OUTCOME_TEXT[table.result.outcome]} · 闲 {table.result.playerPoints} : 庄 {table.result.bankerPoints}
                      </strong>
                      {table.result.natural && <em className="settled-tag is-gold">例牌</em>}
                      {table.result.lucky6 && <em className="settled-tag is-gold">幸运6 ({table.result.lucky6Cards}张)</em>}
                      {table.result.playerPair && <em className="settled-tag is-player">闲对</em>}
                      {table.result.bankerPair && <em className="settled-tag is-banker">庄对</em>}
                    </div>
                    {table.myResult && (
                      <span className={`settled-my-net ${table.myResult.net > 0 ? 'is-win' : table.myResult.net < 0 ? 'is-loss' : 'is-push'}`}>
                        {table.myResult.net > 0
                          ? `本局净赢 ${signed(table.myResult.net)}`
                          : table.myResult.net < 0
                            ? `本局 ${signed(table.myResult.net)}`
                            : '和局退本 0'}
                      </span>
                    )}
                  </div>
                )}
              </div>

              <div className="baccarat-players-strip" aria-label="同桌玩家">
                {(table.players || []).slice(0, mobile ? 4 : 6).map(p => (
                  <div key={p.id} className={`baccarat-seat-chip ${p.id === me.id ? 'is-me' : ''} ${p.betTotal > 0 ? 'has-bet' : ''}`} title={`${p.name}${p.betTotal ? ` · 已押 ${number(p.betTotal)}` : ''}`}>
                    <Avatar user={p} size={26} online={p.online} />
                    <span className="seat-chip-info">
                      <b>{p.name}</b>
                      {settled && p.net !== null ? (
                        <small className={p.net > 0 ? 'is-win' : p.net < 0 ? 'is-loss' : ''}>{signed(p.net)}</small>
                      ) : p.betTotal > 0 ? (
                        <small>{number(p.betTotal)}</small>
                      ) : (
                        <small>观望</small>
                      )}
                    </span>
                  </div>
                ))}
                {(table.players?.length || 0) > (mobile ? 4 : 6) && (
                  <span className="baccarat-seat-more">+{table.players.length - (mobile ? 4 : 6)}</span>
                )}
              </div>
            </div>

            {recentSpeech && (
              <div className="baccarat-speech-toast" key={recentSpeech.id} role="status">
                <b>{recentSpeech.name}</b>
                <span>{recentSpeech.text}</span>
              </div>
            )}

            <div className="baccarat-duel">
              {renderCardSide('player')}
              <div className="duel-center-divider" aria-hidden="true">
                <span className="duel-vs">VS</span>
                {table.tableTotalBet > 0 && (
                  <div className="duel-pot-box">
                    <small>本局总注</small>
                    <Counter value={table.tableTotalBet} />
                  </div>
                )}
              </div>
              {renderCardSide('banker')}
            </div>

            <div className="baccarat-bet-board">
              <div className={`baccarat-side-row cols-${spotDefs.length}`}>
                {spotDefs.map(renderSpotButton)}
              </div>
              <div className="baccarat-main-row">
                {mainDefs.map(renderSpotButton)}
              </div>
            </div>
          </div>
        </section>

        <div className="baccarat-lower-deck">
          <BaccaratRoadmap
            history={table.history}
            mode={table.mode}
            compact={mobile}
            onExpand={mobile ? () => setRoadmapExpanded(true) : undefined}
          />
        </div>
      </div>

      <div className="baccarat-cockpit-wrap">
        <div className="baccarat-cockpit">
            <div className="cockpit-wallet">
              <button type="button" className="cockpit-balance-btn" onClick={() => onPanel('wallet')}>
                <span>通用余额</span>
                <strong aria-label={number(balance)}>{number(balance)}</strong>
              </button>
              <div className="cockpit-bet-stat">
                <span>本局已押</span>
                <strong>{number(table.myTotalBet)}</strong>
              </div>
            </div>

            <div className="cockpit-chip-tray" role="radiogroup" aria-label="选择下注筹码">
              {(table.chips || []).map((val, idx) => {
                const active = selectedChip === val;
                const affordable = balance >= val;
                return (
                  <button
                    key={val}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={`casino-chip-btn tone-${CHIP_PALETTES[idx % CHIP_PALETTES.length]} ${active ? 'is-selected' : ''} ${!affordable ? 'is-low' : ''}`}
                    onClick={() => {
                      setSelectedChip(val);
                      if (mobile) haptic();
                    }}
                  >
                    <span className="chip-rim"><b>{shortChip(val)}</b></span>
                  </button>
                );
              })}
            </div>

            <div className="cockpit-actions">
              <button
                type="button"
                className="arcade-secondary cockpit-btn"
                disabled={locked || busy || !table.canUndo}
                onClick={() => onCommand('undo', { id: table.id })}
                title="撤销上一手筹码"
              >
                <RotateCcw size={15} />
                <span>撤销</span>
              </button>
              <button
                type="button"
                className="arcade-secondary cockpit-btn"
                disabled={locked || busy || !table.canClear}
                onClick={() => onCommand('clear', { id: table.id })}
                title="清空本局全部下注并退回余额"
              >
                <Trash2 size={15} />
                <span>清空</span>
              </button>
              <button
                type="button"
                className="arcade-secondary cockpit-btn"
                disabled={locked || busy || !table.canRebet}
                onClick={() => onCommand('rebet', { id: table.id })}
                title="按上一局注单续押"
              >
                <RefreshCw size={15} />
                <span>续押</span>
              </button>
              <button
                type="button"
                className="arcade-secondary cockpit-btn"
                disabled={locked || busy || !table.canDouble}
                onClick={() => onCommand('double', { id: table.id })}
                title="将本局已下注额翻倍"
              >
                <span>×2</span>
              </button>
              <button
                type="button"
                className={`arcade-primary cockpit-deal-btn ${table.myConfirmed ? 'is-confirmed' : ''}`}
                disabled={locked || busy || table.phase !== 'betting' || table.myTotalBet <= 0 || table.myConfirmed}
                onClick={() => onCommand('deal', { id: table.id })}
              >
                {table.myConfirmed ? <Check size={16} /> : <Play size={15} />}
                <span>
                  {table.myConfirmed
                    ? `已确认 (${table.confirmedCount}/${table.presentCount})`
                    : table.presentCount <= 1
                      ? '立即开牌'
                      : '准备开牌'}
                </span>
              </button>
            </div>
        </div>
      </div>

      <BaccaratChat
        table={table}
        busy={busy || locked}
        onCommand={onCommand}
        mobile={mobile}
        open={chatOpen}
        onClose={() => onChatOpen(false)}
      />

      {historyOpen && (
        <Sheet title="本靴牌局记录" icon={<History size={19} />} onClose={() => onHistoryOpen(false)}>
          <div className="baccarat-log-sheet">
            <div className="baccarat-log-meta">
              <span>第 {table.shoeNumber} 靴 · 已开 {table.roundNumber} 局</span>
              <span>余牌 {table.cardsRemaining} / {table.shoeTotal}</span>
            </div>
            <ol className="baccarat-log-list">
              {(table.log || []).length
                ? [...table.log].reverse().map(entry => (
                  <li key={entry.id}>
                    <span>{entry.text}</span>
                    <time>{new Date(entry.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
                  </li>
                ))
                : <li className="empty">本靴暂无记录</li>}
            </ol>
          </div>
        </Sheet>
      )}

      {mobile && roadmapExpanded && (
        <Sheet title="澳门五路单" icon={<Trophy size={18} />} onClose={() => setRoadmapExpanded(false)} wide>
          <BaccaratRoadmap history={table.history} mode={table.mode} compact={false} />
        </Sheet>
      )}

      {dealing && squeeze?.isMine && (
        <BaccaratSqueeze
          squeeze={squeeze}
          roundId={table.roundId}
          existingCards={squeezeExisting}
          opponentLabel={squeezeOppSide === 'banker' ? '庄家' : '闲家'}
          opponentPoints={squeezeOppPts}
          now={now}
          busy={busy}
          onComplete={completeSqueeze}
          onSound={playSound}
        />
      )}
    </main>
  );
}
