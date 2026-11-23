import React, { useEffect, useState } from 'react';
import { ArrowRight, ChevronRight, CircleHelp, Coins, Globe, KeyRound, Lock, Plus, RefreshCw, Trophy, Users } from 'lucide-react';
import { Avatar } from '../components';
import { Sheet } from './ArcadePanels';
import { MiniBigRoad } from './BaccaratRoadmap';

const games = [
  { id: 'poker', name: '德州扑克', caption: 'TEXAS HOLD’EM', players: '2–6 人', tag: '无限注' },
  { id: 'baccarat', name: '澳门百家乐', caption: 'MACAU BACCARAT', players: '随时上桌', tag: '8 副牌 · 咪牌' },
];
const phases = { waiting: '等待入座', preflop: '牌局进行中', flop: '牌局进行中', turn: '牌局进行中', river: '牌局进行中', showdown: '本手结算' };
const baccaratPhases = { open: '开放下注', betting: '下注倒计时', dealing: '派牌 / 咪牌中', settled: '本局结算' };
const number = value => Number(value || 0).toLocaleString('zh-CN');

function CreateTable({ game, me, connected, inHand, onCommand, onClose }) {
  const [name, setName] = useState(''), [base, setBase] = useState('10'), [hands, setHands] = useState('0'), [visibility, setVisibility] = useState('public');
  const smallBlind = Number(base), handLimit = Number(hands);
  const validBase = base !== '' && Number.isSafeInteger(smallBlind) && smallBlind >= 1 && smallBlind <= 1000000;
  const validHands = hands !== '' && Number.isSafeInteger(handLimit) && handLimit >= 0 && handLimit <= 1000;
  const buyIn = Math.min(smallBlind * 200, game.wallet?.total || 0);
  const disabled = game.busy || !connected || inHand || !validBase || !validHands || (game.wallet?.total || 0) < smallBlind * 2;
  const submit = async event => {
    event.preventDefault(); if (disabled) return;
    if (await onCommand('create', { name: name.trim() || `${me.name}的牌桌`, smallBlind, handLimit, visibility })) onClose();
  };
  return <Sheet title="创建牌桌" icon={<Plus size={20} />} onClose={onClose}>
    <form className="create-table-form" onSubmit={submit}>
      <label htmlFor="arcade-room-name">牌桌名称<input id="arcade-room-name" maxLength={32} value={name} placeholder={`${me.name}的牌桌`} onChange={event => setName(event.target.value)} /></label>
      <div className="create-visibility-field">
        <span className="create-field-label">房间类型</span>
        <div className="visibility-picker" role="radiogroup" aria-label="房间类型">
          <button type="button" role="radio" aria-checked={visibility === 'public'} className={`visibility-option ${visibility === 'public' ? 'selected' : ''}`} onClick={() => setVisibility('public')}>
            <span className="visibility-option-head"><Globe size={15} /><b>公开牌桌</b></span>
            <small>大厅可见，所有成员可进入</small>
          </button>
          <button type="button" role="radio" aria-checked={visibility === 'private'} className={`visibility-option ${visibility === 'private' ? 'selected' : ''}`} onClick={() => setVisibility('private')}>
            <span className="visibility-option-head"><Lock size={15} /><b>私密牌桌</b></span>
            <small>大厅隐藏，凭邀请或口令进入</small>
          </button>
        </div>
      </div>
      <div className="create-table-fields">
        <label htmlFor="arcade-base">底分（小盲注）<input id="arcade-base" type="number" inputMode="numeric" min="1" max="1000000" step="1" required value={base} onChange={event => setBase(event.target.value)} /></label>
        <label htmlFor="arcade-hands">每场手数（0 为不限）<input id="arcade-hands" type="number" inputMode="numeric" min="0" max="1000" step="1" required value={hands} onChange={event => setHands(event.target.value)} /></label>
      </div>
      <div className="stake-presets" aria-label="底分预设">{[10, 50, 100, 500].map(amount => <button type="button" className={smallBlind === amount ? 'selected' : ''} key={amount} onClick={() => setBase(String(amount))}>{amount}</button>)}</div>
      <div className="stake-presets create-hands-presets" aria-label="手数预设">{[0, 5, 10, 20].map(count => <button type="button" className={handLimit === count ? 'selected' : ''} key={count} onClick={() => setHands(String(count))}>{count ? `${count} 手` : '不限手数'}</button>)}</div>
      <dl className="create-table-summary">
        <div><dt>牌桌买入</dt><dd>{validBase ? number(buyIn) : '—'}</dd></div>
        <div><dt>小盲 / 大盲</dt><dd>{validBase ? `${number(smallBlind)} / ${number(smallBlind * 2)}` : '—'}</dd></div>
        <div><dt>房间可见性</dt><dd className="is-text">{visibility === 'private' ? '私密 · 建房后生成口令' : '公开 · 大厅可见'}</dd></div>
      </dl>
      {game.error && <p className="arcade-panel-error" role="alert">{game.error}</p>}
      <button className="arcade-primary" disabled={disabled}>创建并入座<ArrowRight size={17} /></button>
    </form>
  </Sheet>;
}

function JoinPrivateTable({ game, connected, onCommand, onClose }) {
  const [code, setCode] = useState('');
  const normalized = code.trim().replace(/[\s-]+/g, '').toUpperCase();
  const valid = /^[A-Z0-9]{6}$/.test(normalized);
  const disabled = game.busy || !connected || !valid;
  const submit = async event => {
    event.preventDefault();
    if (disabled) return;
    if (await onCommand('enter', { code: normalized })) onClose();
  };
  return <Sheet title="口令进房" icon={<KeyRound size={20} />} onClose={onClose}>
    <form className="create-table-form join-private-form" onSubmit={submit}>
      <label htmlFor="arcade-room-code">
        房间口令
        <input
          id="arcade-room-code"
          className="room-code-input"
          value={code}
          maxLength={12}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="输入 6 位房间口令"
          onChange={event => {
            if (game.error) game.clearError?.();
            setCode(event.target.value.toUpperCase());
          }}
        />
      </label>
      <p className="join-private-hint">私密牌桌不在大厅展示，输入好友分享的 6 位房间口令即可进入对应牌桌。</p>
      {game.error && <p className="arcade-panel-error" role="alert">{game.error}</p>}
      <button className="arcade-primary" disabled={disabled}>进入牌桌<ArrowRight size={17} /></button>
    </form>
  </Sheet>;
}

export default function ArcadeLobby({
  game,
  baccarat,
  me,
  connected,
  table,
  selectedGame,
  creating = false,
  onCreating,
  joining = false,
  onJoining,
  onSelect,
  onView,
  onViewBaccarat,
  onReturn,
  onCommand,
  onPanel,
  onRules,
  art,
  baccaratArt,
  roomIcon,
}) {
  const [localCreating, setLocalCreating] = useState(false);
  const [localJoining, setLocalJoining] = useState(false);
  const isCreating = onCreating ? creating : localCreating;
  const setCreating = onCreating || setLocalCreating;
  const isJoining = onJoining ? joining : localJoining;
  const setJoining = onJoining || setLocalJoining;
  useEffect(() => { setCreating(false); setJoining(false); }, [selectedGame, setCreating, setJoining]);
  const openCreating = () => { game.clearError?.(); setCreating(true); };
  const closeCreating = () => { game.clearError?.(); setCreating(false); };
  const openJoining = () => { game.clearError?.(); setJoining(true); };
  const closeJoining = () => { game.clearError?.(); setJoining(false); };
  const membership = game.membership;
  const seatedId = membership && !membership.leaving ? membership.tableId : null;
  const inHand = Boolean(membership?.inHand);
  const rooms = game.tables || [];
  const baccaratRooms = baccarat?.tables || game.baccaratTables || [];
  const baccaratPlayersTotal = baccaratRooms.reduce((sum, item) => sum + (item.playerCount || 0), 0);
  const activeWallet = (selectedGame === 'baccarat' ? baccarat?.wallet : null) || game.wallet;

  const headingMeta = selectedGame === 'baccarat'
    ? { eyebrow: 'MACAU BACCARAT', title: '澳门百家乐' }
    : selectedGame === 'poker'
      ? { eyebrow: 'TEXAS HOLD’EM', title: '德州扑克' }
      : { eyebrow: '', title: '全部游戏' };

  return <>
    <main className={`arcade-lobby ${selectedGame ? 'poker-lobby' : 'game-catalog'}`}>
      <div className="arcade-lobby-heading">
        <div>
          {headingMeta.eyebrow && <span className="arcade-eyebrow">{headingMeta.eyebrow}</span>}
          <h2>{headingMeta.title}</h2>
        </div>
        <div className="arcade-lobby-tools">
          {selectedGame && <button onClick={() => onPanel('rank')}><Trophy size={17} />排行榜</button>}
          <button className="arcade-balance-button" onClick={() => onPanel('wallet')}>
            <Coins size={18} />
            <span><small>可用筹码</small><b>{number(activeWallet?.balance)}</b></span>
          </button>
          <Avatar user={me} size={34} />
        </div>
      </div>

      {!selectedGame ? (
        <div className="arcade-game-grid">
          {games.map(item => {
            const isBac = item.id === 'baccarat';
            return (
              <article key={item.id} className={`arcade-feature arcade-game-card ${isBac ? 'is-baccarat' : ''}`}>
                <div className="feature-copy">
                  <span className="arcade-eyebrow">{item.caption}</span>
                  <h2>{item.name}</h2>
                  <div className="feature-meta">
                    <span><Users size={15} />{item.players}</span>
                    <span>{item.tag}</span>
                  </div>
                </div>
                <div className="feature-art" aria-hidden="true">{isBac ? baccaratArt : art}</div>
                <div className="game-card-footer">
                  <span>
                    {isBac
                      ? (baccaratPlayersTotal > 0 ? <><i />{baccaratRooms.length} 张荷官台 · {baccaratPlayersTotal} 人在桌</> : `${baccaratRooms.length || 4} 张系统荷官台`)
                      : (seatedId ? <><i />已入座</> : membership?.leaving ? <><i />本手结算中</> : `${rooms.length} 张公开牌桌`)}
                  </span>
                  <button onClick={() => onSelect(item.id)} aria-label={`进入${item.name}`}>进入游戏<ArrowRight size={18} /></button>
                </div>
              </article>
            );
          })}
        </div>
      ) : selectedGame === 'baccarat' ? (
        <section className="arcade-tables">
          <div className="tables-heading">
            <h3>系统荷官牌桌<span>{baccaratRooms.length}</span></h3>
            <div className="poker-lobby-actions">
              <button className="arcade-text" onClick={() => baccarat?.refresh?.()} aria-label="刷新牌桌">
                <RefreshCw size={16} />
              </button>
            </div>
          </div>
          <div className="room-list">
            {baccaratRooms.map(room => (
              <button
                key={room.id}
                type="button"
                className="arcade-room baccarat-lobby-room"
                onClick={() => onViewBaccarat(room.id)}
              >
                <div className="baccarat-lobby-main">
                  <div className="baccarat-lobby-title">
                    <strong>{room.name}</strong>
                    <span className="baccarat-mode-badge">{room.mode === 'no-commission' ? '免佣 · 幸运6' : '传统抽水 5%'}</span>
                  </div>
                  <div className="baccarat-lobby-meta">
                    <span>限红 {number(room.minBet)} – {number(room.maxBet)}</span>
                    <span>第 {room.shoeNumber} 靴 · 余 {room.cardsRemaining} 张</span>
                    <span>{baccaratPhases[room.phase] || '开放下注'}</span>
                  </div>
                  <div className="baccarat-lobby-stats">
                    <span className="c-b">庄 {room.stats?.banker || 0}</span>
                    <span className="c-p">闲 {room.stats?.player || 0}</span>
                    <span className="c-t">和 {room.stats?.tie || 0}</span>
                  </div>
                </div>
                <div className="baccarat-lobby-right">
                  <MiniBigRoad history={room.recentHistory || []} />
                  <span className="room-seats"><Users size={15} />{room.playerCount || 0}</span>
                  <ChevronRight size={18} />
                </div>
              </button>
            ))}
          </div>
        </section>
      ) : (
        <section className="arcade-tables">
          <div className="tables-heading">
            <h3>公开牌桌<span>{rooms.length}</span></h3>
            <div className="poker-lobby-actions">
              <button className="arcade-text" onClick={game.refresh} aria-label="刷新牌桌"><RefreshCw size={16} /></button>
              <button className="arcade-secondary" disabled={game.busy || !connected} onClick={openJoining}><KeyRound size={15} />口令进房</button>
              <button className="arcade-primary" disabled={game.busy || !connected || inHand} onClick={openCreating}><Plus size={16} />开桌</button>
            </div>
          </div>
          {seatedId && !rooms.some(room => room.id === seatedId) && (
            <button className="return-table" onClick={() => table?.id === seatedId ? onReturn() : onView(seatedId)}>
              <span className="return-room-name">
                <i />
                <b>{membership.tableName}</b>
                {membership.visibility === 'private' && <em className="room-visibility-badge"><Lock size={11} />私密</em>}
              </span>
              <span>返回牌桌<ArrowRight size={15} /></span>
            </button>
          )}
          <div className="room-list">
            {rooms.length ? rooms.map(room => {
              const seated = seatedId === room.id;
              return (
                <button className={`arcade-room ${seated ? 'is-seated' : ''}`} key={room.id} onClick={() => seated && table?.id === room.id ? onReturn() : onView(room.id)}>
                  <span className="room-suit">{roomIcon}</span>
                  <span className="room-info">
                    <strong title={room.name}>{room.name}</strong>
                    <small>盲注 {room.smallBlind} / {room.bigBlind} · {room.matchComplete ? '本场结束' : phases[room.phase]}{seated && ' · 已入座'}</small>
                  </span>
                  <span className="room-seats"><Users size={15} />{room.playerCount} / {room.maxPlayers}</span>
                  <ChevronRight size={18} />
                </button>
              );
            }) : (
              <div className="rooms-empty">
                <span className="empty-table-icon">{roomIcon}</span>
                <h4>还没有公开牌桌</h4>
                <p>点击开桌创建公开或私密牌桌，或通过口令进入好友的私密牌桌。</p>
              </div>
            )}
          </div>
        </section>
      )}
      <footer className="arcade-lobby-footer">
        <span>通用总账户筹码 · 仅供娱乐，不可充值或兑换</span>
        {selectedGame && <button className="arcade-text" onClick={onRules}><CircleHelp size={15} />玩法规则</button>}
      </footer>
    </main>
    {isCreating && selectedGame === 'poker' && <CreateTable game={game} me={me} connected={connected} inHand={inHand} onCommand={onCommand} onClose={closeCreating} />}
    {isJoining && selectedGame === 'poker' && <JoinPrivateTable game={game} connected={connected} onCommand={onCommand} onClose={closeJoining} />}
  </>;
}
