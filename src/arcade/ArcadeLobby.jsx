import React, { useEffect, useState } from 'react';
import { ArrowRight, ChevronRight, CircleHelp, Coins, Plus, RefreshCw, Trophy, Users } from 'lucide-react';
import { Avatar } from '../components';
import { Sheet } from './ArcadePanels';

const games = [{ id: 'poker', name: '德州扑克', caption: 'TEXAS HOLD’EM', players: '2–6 人' }];
const phases = { waiting: '等待入座', preflop: '牌局进行中', flop: '牌局进行中', turn: '牌局进行中', river: '牌局进行中', showdown: '本手结算' };
const number = value => Number(value || 0).toLocaleString('zh-CN');

function CreateTable({ game, me, connected, inHand, onCommand, onClose }) {
  const [name, setName] = useState(''), [base, setBase] = useState('10'), [hands, setHands] = useState('0');
  const smallBlind = Number(base), handLimit = Number(hands);
  const validBase = base !== '' && Number.isSafeInteger(smallBlind) && smallBlind >= 1 && smallBlind <= 1000000;
  const validHands = hands !== '' && Number.isSafeInteger(handLimit) && handLimit >= 0 && handLimit <= 1000;
  const buyIn = Math.min(smallBlind * 200, game.wallet?.total || 0);
  const disabled = game.busy || !connected || inHand || !validBase || !validHands || (game.wallet?.total || 0) < smallBlind * 2;
  const submit = async event => {
    event.preventDefault(); if (disabled) return;
    if (await onCommand('create', { name: name.trim() || `${me.name}的牌桌`, smallBlind, handLimit })) onClose();
  };
  return <Sheet title="创建牌桌" icon={<Plus size={20} />} onClose={onClose}>
    <form className="create-table-form" onSubmit={submit}>
      <label htmlFor="arcade-room-name">牌桌名称<input id="arcade-room-name" maxLength={32} value={name} placeholder={`${me.name}的牌桌`} onChange={event => setName(event.target.value)} /></label>
      <div className="create-table-fields">
        <label htmlFor="arcade-base">底分（小盲注）<input id="arcade-base" type="number" inputMode="numeric" min="1" max="1000000" step="1" required value={base} onChange={event => setBase(event.target.value)} /></label>
        <label htmlFor="arcade-hands">每场手数（0 为不限）<input id="arcade-hands" type="number" inputMode="numeric" min="0" max="1000" step="1" required value={hands} onChange={event => setHands(event.target.value)} /></label>
      </div>
      <div className="stake-presets" aria-label="底分预设">{[10, 50, 100, 500].map(amount => <button type="button" className={smallBlind === amount ? 'selected' : ''} key={amount} onClick={() => setBase(String(amount))}>{amount}</button>)}</div>
      <div className="stake-presets create-hands-presets" aria-label="手数预设">{[0, 5, 10, 20].map(count => <button type="button" className={handLimit === count ? 'selected' : ''} key={count} onClick={() => setHands(String(count))}>{count ? `${count} 手` : '不限手数'}</button>)}</div>
      <dl className="create-table-summary"><div><dt>牌桌买入</dt><dd>{validBase ? number(buyIn) : '—'}</dd></div><div><dt>小盲 / 大盲</dt><dd>{validBase ? `${number(smallBlind)} / ${number(smallBlind * 2)}` : '—'}</dd></div></dl>
      {game.error && <p className="arcade-panel-error" role="alert">{game.error}</p>}
      <button className="arcade-primary" disabled={disabled}>创建并入座<ArrowRight size={17} /></button>
    </form>
  </Sheet>;
}

export default function ArcadeLobby({ game, me, connected, table, selectedGame, creating = false, onCreating, onSelect, onView, onReturn, onCommand, onPanel, onRules, art, roomIcon }) {
  const [localCreating, setLocalCreating] = useState(false);
  const isCreating = onCreating ? creating : localCreating;
  const setCreating = onCreating || setLocalCreating;
  useEffect(() => setCreating(false), [selectedGame, setCreating]);
  const membership = game.membership;
  const seatedId = membership && !membership.leaving ? membership.tableId : null;
  const inHand = Boolean(membership?.inHand);
  const rooms = game.tables || [];
  return <>
    <main className={`arcade-lobby ${selectedGame ? 'poker-lobby' : 'game-catalog'}`}>
      <div className="arcade-lobby-heading"><div>{selectedGame && <span className="arcade-eyebrow">TEXAS HOLD’EM</span>}<h2>{selectedGame ? '德州扑克' : '全部游戏'}</h2></div>
        <div className="arcade-lobby-tools">{selectedGame && <button onClick={() => onPanel('rank')}><Trophy size={17} />排行榜</button>}<button className="arcade-balance-button" onClick={() => onPanel('wallet')}><Coins size={18} /><span><small>可用筹码</small><b>{number(game.wallet?.balance)}</b></span></button><Avatar user={me} size={34} /></div>
      </div>
      {!selectedGame ? <div className="arcade-game-grid">{games.map(item => <article key={item.id} className="arcade-feature arcade-game-card">
        <div className="feature-copy"><span className="arcade-eyebrow">{item.caption}</span><h2>{item.name}</h2><div className="feature-meta"><span><Users size={15} />{item.players}</span><span>无限注</span></div></div>
        <div className="feature-art" aria-hidden="true">{item.id === 'poker' && art}</div>
        <div className="game-card-footer"><span>{seatedId ? <><i />已入座</> : membership?.leaving ? <><i />本手结算中</> : `${rooms.length} 张牌桌`}</span><button onClick={() => onSelect(item.id)} aria-label={`进入${item.name}`}>进入游戏<ArrowRight size={18} /></button></div>
      </article>)}</div> : <section className="arcade-tables">
        <div className="tables-heading"><h3>正在开放的牌桌<span>{rooms.length}</span></h3><div className="poker-lobby-actions"><button className="arcade-text" onClick={game.refresh} aria-label="刷新牌桌"><RefreshCw size={16} /></button><button className="arcade-primary" disabled={game.busy || !connected || inHand} onClick={() => setCreating(true)}><Plus size={16} />开桌</button></div></div>
        {seatedId && !rooms.some(room => room.id === seatedId) && <button className="return-table" onClick={() => table?.id === seatedId ? onReturn() : onView(seatedId)}><span className="return-room-name"><i /><b>{membership.tableName}</b></span><span>返回牌桌<ArrowRight size={15} /></span></button>}
        <div className="room-list">{rooms.length ? rooms.map(room => {
          const seated = seatedId === room.id;
          return <button className={`arcade-room ${seated ? 'is-seated' : ''}`} key={room.id} onClick={() => seated && table?.id === room.id ? onReturn() : onView(room.id)}><span className="room-suit">{roomIcon}</span><span className="room-info"><strong title={room.name}>{room.name}</strong><small>盲注 {room.smallBlind} / {room.bigBlind} · {room.matchComplete ? '本场结束' : phases[room.phase]}{seated && ' · 已入座'}</small></span><span className="room-seats"><Users size={15} />{room.playerCount} / {room.maxPlayers}</span><ChevronRight size={18} /></button>;
        }) : <div className="rooms-empty"><span className="empty-table-icon">{roomIcon}</span><h4>还没有牌桌</h4><p>点击开桌，邀请好友一起玩。</p></div>}</div>
      </section>}
      <footer className="arcade-lobby-footer"><span>筹码仅供娱乐，不可充值或兑换</span>{selectedGame && <button className="arcade-text" onClick={onRules}><CircleHelp size={15} />玩法规则</button>}</footer>
    </main>
    {isCreating && <CreateTable game={game} me={me} connected={connected} inHand={inHand} onCommand={onCommand} onClose={() => setCreating(false)} />}
  </>;
}
