import { randomInt, randomUUID } from 'node:crypto';

const SMALL_BLIND = 10;
const BIG_BLIND = 20;
const BUY_IN = 2000;
const MAX_PLAYERS = 6;
const SEAT_ORDER = [0, 3, 1, 4, 2, 5];
const RANKS = '23456789TJQKA';
const SUITS = 'shdc';
const PHASES = ['preflop', 'flop', 'turn', 'river'];
const HAND_NAMES = ['高牌', '一对', '两对', '三条', '顺子', '同花', '葫芦', '四条', '同花顺'];
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const playing = table => PHASES.includes(table.phase);
const active = table => table.players.filter(player => player.inHand && !player.folded);
const capable = table => active(table).filter(player => player.stack > 0);
const orderedAfter = (players, seat) => [...players].sort((a, b) => ((a.seat - seat + MAX_PLAYERS - 1) % MAX_PLAYERS) - ((b.seat - seat + MAX_PLAYERS - 1) % MAX_PLAYERS));

function fiveCardValue(cards) {
  const ranks = cards.map(card => RANKS.indexOf(card[0]) + 2).sort((a, b) => b - a);
  const counts = new Map();
  for (const rank of ranks) counts.set(rank, (counts.get(rank) || 0) + 1);
  const groups = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const flush = cards.every(card => card[1] === cards[0][1]);
  const unique = [...counts.keys()];
  const straight = unique.length === 5 && (unique[0] - unique[4] === 4 ? unique[0] : unique.join(',') === '14,5,4,3,2' ? 5 : 0);
  let values;
  if (flush && straight) values = [8, straight];
  else if (groups[0][1] === 4) values = [7, groups[0][0], groups[1][0]];
  else if (groups[0][1] === 3 && groups[1][1] === 2) values = [6, groups[0][0], groups[1][0]];
  else if (flush) values = [5, ...ranks];
  else if (straight) values = [4, straight];
  else if (groups[0][1] === 3) values = [3, ...groups.map(group => group[0])];
  else if (groups[0][1] === 2 && groups[1][1] === 2) values = [2, ...groups.map(group => group[0])];
  else if (groups[0][1] === 2) values = [1, ...groups.map(group => group[0])];
  else values = [0, ...ranks];
  const category = values[0];
  while (values.length < 6) values.push(0);
  return { value: values.reduce((value, rank) => value * 15 + rank, 0), name: category === 8 && straight === 14 ? '皇家同花顺' : HAND_NAMES[category] };
}

// 用全部 5 张组合比较，允许公共牌直接成牌；花色不参与同牌型的平手判定。
export function evaluateHand(cards) {
  if (!Array.isArray(cards) || cards.length < 5 || cards.length > 7 || new Set(cards).size !== cards.length || cards.some(card => typeof card !== 'string' || card.length !== 2 || !RANKS.includes(card[0]) || !SUITS.includes(card[1]))) throw fail('牌面无效');
  let best = null;
  for (let a = 0; a < cards.length - 4; a++) for (let b = a + 1; b < cards.length - 3; b++) for (let c = b + 1; c < cards.length - 2; c++) for (let d = c + 1; d < cards.length - 1; d++) for (let e = d + 1; e < cards.length; e++) {
    const hand = [cards[a], cards[b], cards[c], cards[d], cards[e]];
    const result = fiveCardValue(hand);
    if (!best || result.value > best.value) best = { ...result, cards: hand };
  }
  return best;
}

function shuffledDeck() {
  const deck = [...SUITS].flatMap(suit => [...RANKS].map(rank => rank + suit));
  for (let index = deck.length - 1; index > 0; index--) {
    const other = randomInt(index + 1);
    [deck[index], deck[other]] = [deck[other], deck[index]];
  }
  return deck;
}

// 牌桌为本次服务进程内的娱乐局，筹码不兑换、不持久化。所有私牌只在 state 中按身份投影。
export function createPoker({ changed = () => {}, onlineIds = () => new Set(), now = Date.now, turnMs = 30000, runoutMs = 900 } = {}) {
  const tables = new Map();
  let closed = false;
  const findMembership = userId => [...tables.values()].find(table => table.players.some(player => player.id === userId));
  const requireTable = id => {
    const table = typeof id === 'string' && tables.get(id);
    if (!table) throw fail('牌桌已结束或不存在', 404);
    return table;
  };
  const requirePlayer = (table, userId) => {
    const player = table.players.find(item => item.id === userId && !item.leaving);
    if (!player) throw fail('请先加入这张牌桌', 403);
    player.lastSeen = now();
    return player;
  };
  const log = (table, text) => {
    table.log.push({ id: randomUUID(), at: now(), text });
    if (table.log.length > 40) table.log.shift();
  };
  const publish = table => {
    if (closed) return;
    if (table) { table.revision++; table.updatedAt = now(); }
    changed({ type: 'arcade-changed', ...(table ? { id: table.id } : {}) });
  };
  const stopTimer = table => { clearTimeout(table.timer); table.timer = null; table.deadline = null; };
  const transferHost = table => {
    if (!table.players.some(player => player.id === table.hostId && !player.leaving)) table.hostId = table.players.find(player => !player.leaving)?.id || null;
  };
  const cleanupLeavers = table => {
    // 当前手参与者即使已离桌也必须保留到结算，避免后来加入的旁观玩家离开时带走其底池记录。
    table.players = table.players.filter(player => !player.leaving || (playing(table) && player.inHand));
    transferHost(table);
    if (!table.players.length) { stopTimer(table); tables.delete(table.id); }
  };
  const targetBet = table => capable(table).length <= 1 ? Math.max(0, ...active(table).map(player => player.bet)) : table.currentBet;
  const canRaise = (table, player) => capable(table).some(other => other.id !== player.id) && (player.actedBet === null || table.currentBet - player.actedBet >= player.reopenSize);
  const legalActions = (table, userId) => {
    const player = table.players.find(item => item.id === userId);
    const canAct = Boolean(playing(table) && player && !player.leaving && !player.folded && player.inHand && player.stack > 0 && table.turnSeat === player.seat);
    const toCall = player ? Math.min(player.stack, Math.max(0, targetBet(table) - player.bet)) : 0;
    const maxRaiseTo = player ? player.bet + player.stack : 0;
    const raise = canAct && maxRaiseTo > table.currentBet && canRaise(table, player);
    return { canAct, canCheck: canAct && toCall === 0, toCall, canRaise: raise && maxRaiseTo >= table.currentBet + table.minRaise,
      minRaiseTo: table.currentBet + table.minRaise, maxRaiseTo, canAllIn: canAct && (maxRaiseTo <= targetBet(table) || raise) };
  };
  const pay = (player, amount) => {
    const paid = Math.min(player.stack, amount);
    player.stack -= paid; player.bet += paid; player.contribution += paid;
    player.allIn = player.stack === 0;
    return paid;
  };
  const refundUncalled = table => {
    const players = table.players.filter(player => player.inHand).sort((a, b) => b.bet - a.bet);
    if (!players.length) return;
    const refund = players[0].bet - (players[1]?.bet || 0);
    if (refund > 0) {
      const player = players[0];
      player.stack += refund; player.bet -= refund; player.contribution -= refund; player.allIn = false;
      log(table, `${player.name} 收回无人跟注的 ${refund} 筹码`);
    }
  };
  const finish = (table, reason) => {
    stopTimer(table);
    refundUncalled(table);
    const live = active(table);
    const totalPot = table.players.reduce((total, player) => total + player.contribution, 0);
    const ranks = new Map(reason === 'showdown' ? live.map(player => [player.id, evaluateHand([...player.cards, ...table.board])]) : []);
    const amounts = new Map();
    const pots = [];
    const award = (amount, contenders) => {
      const value = reason === 'showdown' ? Math.max(...contenders.map(player => ranks.get(player.id).value)) : null;
      const winners = orderedAfter(contenders.filter(player => reason !== 'showdown' || ranks.get(player.id).value === value), table.buttonSeat);
      const share = Math.floor(amount / winners.length), odd = amount % winners.length;
      winners.forEach((player, index) => amounts.set(player.id, (amounts.get(player.id) || 0) + share + (index < odd ? 1 : 0)));
      pots.push({ amount, winnerIds: winners.map(player => player.id) });
    };
    if (reason === 'fold') award(totalPot, live);
    else {
      const levels = [...new Set(table.players.filter(player => player.contribution > 0).map(player => player.contribution))].sort((a, b) => a - b);
      let previous = 0;
      for (const level of levels) {
        const contributors = table.players.filter(player => player.contribution >= level);
        const amount = (level - previous) * contributors.length;
        const eligible = live.filter(player => player.contribution >= level);
        // 合法下注序列的每层池都至少有一位仍在局中的参与者。
        if (!eligible.length) throw new Error('Poker side pot has no eligible player');
        award(amount, eligible);
        previous = level;
      }
    }
    const winners = [...amounts].map(([id, amount]) => ({ id, amount, hand: ranks.get(id)?.name || '其他玩家弃牌' }));
    for (const player of table.players) { player.winAmount = amounts.get(player.id) || 0; player.stack += player.winAmount; player.ready = false; }
    table.result = { reason, winners, pots, totalPot };
    table.phase = 'showdown'; table.turnSeat = null; table.currentBet = 0;
    for (const winner of winners) log(table, `${table.players.find(player => player.id === winner.id).name} 赢得 ${winner.amount} 筹码${reason === 'showdown' ? ` · ${winner.hand}` : ''}`);
    cleanupLeavers(table);
  };
  const nextStreet = table => {
    stopTimer(table);
    refundUncalled(table);
    if (table.phase === 'river') { finish(table, 'showdown'); return; }
    table.phase = PHASES[PHASES.indexOf(table.phase) + 1];
    table.deck.pop(); // 每条公共牌街先烧一张牌。
    for (let count = table.phase === 'flop' ? 3 : 1; count > 0; count--) table.board.push(table.deck.pop());
    table.currentBet = 0; table.minRaise = BIG_BLIND;
    for (const player of table.players) { player.bet = 0; player.actedBet = null; player.reopenSize = BIG_BLIND; if (player.inHand && !player.folded) player.lastAction = ''; }
    log(table, `${{ flop: '翻牌', turn: '转牌', river: '河牌' }[table.phase]} · ${table.board.join(' ')}`);
    progress(table, table.buttonSeat);
  };
  const progress = (table, afterSeat) => {
    if (active(table).length === 1) { finish(table, 'fold'); return; }
    const actors = capable(table), target = targetBet(table);
    // 全下后只剩一人还能下注、且不再需要跟注时，逐街发完公共牌。
    if (actors.length <= 1 && (!actors.length || actors[0].bet >= target)) {
      table.turnSeat = null; table.deadline = null;
      stopTimer(table);
      table.timer = setTimeout(() => { if (!closed && tables.has(table.id)) { nextStreet(table); publish(table); } }, runoutMs);
      table.timer.unref?.();
      return;
    }
    const pending = actors.filter(player => player.actedBet === null || player.bet < target);
    if (!pending.length) { nextStreet(table); return; }
    const player = orderedAfter(pending, afterSeat)[0];
    table.turnSeat = player.seat;
    stopTimer(table);
    if (player.leaving) { perform(table, player, player.bet >= target ? 'check' : 'fold'); return; }
    table.deadline = now() + turnMs;
    table.timer = setTimeout(() => {
      if (closed || !tables.has(table.id) || table.turnSeat !== player.seat || !playing(table)) return;
      perform(table, player, player.bet >= targetBet(table) ? 'check' : 'fold', undefined, true);
      publish(table);
    }, turnMs);
    table.timer.unref?.();
  };
  const perform = (table, player, action, amount, automatic = false) => {
    const target = targetBet(table);
    const owed = Math.max(0, target - player.bet);
    const maximum = player.bet + player.stack;
    let label;
    if (action === 'fold') { player.folded = true; label = '弃牌'; }
    else if (action === 'check') { if (owed) throw fail('需要跟注后才能继续'); label = '过牌'; }
    else if (action === 'call') { if (!owed) throw fail('当前无需跟注，请过牌'); const paid = pay(player, owed); label = `${player.allIn ? '全下跟注' : '跟注'} ${paid}`; }
    else if (action === 'raise' || action === 'all-in') {
      const total = action === 'all-in' ? maximum : amount;
      if (!Number.isSafeInteger(total) || total <= player.bet || total > maximum) throw fail('下注数量无效');
      if (total <= target) {
        if (action !== 'all-in') throw fail('加注必须高于当前下注');
        pay(player, total - player.bet); label = `全下跟注 ${total}`;
      } else {
        if (!canRaise(table, player)) throw fail('本轮不能再加注');
        if (total < table.currentBet + table.minRaise && total !== maximum) throw fail(`至少加注到 ${table.currentBet + table.minRaise}`);
        const increase = total - table.currentBet;
        if (increase >= table.minRaise) table.minRaise = increase;
        pay(player, total - player.bet); table.currentBet = total;
        label = `${player.allIn ? '全下' : '加注到'} ${total}`;
      }
    } else throw fail('无效的牌桌操作');
    stopTimer(table);
    player.actedBet = table.currentBet;
    player.reopenSize = table.minRaise;
    player.lastAction = `${automatic ? '超时' : ''}${label}`;
    log(table, `${player.name} ${player.lastAction}`);
    progress(table, player.seat);
  };
  const summary = table => ({ id: table.id, name: table.name, hostId: table.hostId, playerCount: table.players.filter(player => !player.leaving).length,
    maxPlayers: MAX_PLAYERS, phase: table.phase, smallBlind: SMALL_BLIND, bigBlind: BIG_BLIND, handNumber: table.handNumber });
  const view = (table, userId) => {
    const online = onlineIds();
    return { ...summary(table), buyIn: BUY_IN, handId: table.handId, revision: table.revision,
      buttonSeat: table.buttonSeat, smallBlindSeat: table.smallBlindSeat, bigBlindSeat: table.bigBlindSeat,
      turnSeat: table.turnSeat, deadline: table.deadline, board: [...table.board],
      pot: table.result?.totalPot ?? table.players.reduce((total, player) => total + player.contribution, 0),
      currentBet: table.currentBet, minRaise: table.minRaise, result: table.result, log: [...table.log], actions: legalActions(table, userId),
      players: table.players.map(player => ({ id: player.id, name: player.name, avatar: player.avatar, seat: player.seat, stack: player.stack,
        bet: player.bet, contribution: player.contribution, ready: player.ready, inHand: player.inHand, folded: player.folded, allIn: player.allIn,
        leaving: player.leaving, online: online.has(player.id), cards: player.id === userId || (table.phase === 'showdown' && table.result?.reason === 'showdown' && player.inHand && !player.folded) ? [...player.cards] : null,
        cardCount: player.cards.length, lastAction: player.lastAction, winAmount: player.winAmount })) };
  };
  const state = (user, id) => {
    const seated = findMembership(user.id);
    const self = seated?.players.find(player => player.id === user.id);
    if (self) { self.lastSeen = now(); self.name = user.name; self.avatar = user.avatar; }
    const table = id ? requireTable(id) : self && !self.leaving ? seated : null;
    return { tables: [...tables.values()].map(summary), table: table ? view(table, user.id) : null, serverTime: now() };
  };
  const addPlayer = (table, user, requestedSeat) => {
    if (requestedSeat !== undefined && (!Number.isInteger(requestedSeat) || requestedSeat < 0 || requestedSeat >= MAX_PLAYERS)) throw fail('座位无效');
    const existing = findMembership(user.id);
    if (existing) {
      const player = existing.players.find(item => item.id === user.id);
      if (existing.id === table.id && !player.leaving) {
        if (requestedSeat !== undefined && requestedSeat !== player.seat) throw fail('你已经在这张牌桌入座', 409);
        return;
      }
      throw fail('请先离开当前牌桌；正在进行的一手需结算后才能换桌', 409);
    }
    if (requestedSeat !== undefined && table.players.some(player => player.seat === requestedSeat)) throw fail('这个座位已经有人了', 409);
    if (table.players.length >= MAX_PLAYERS) throw fail('牌桌已满，可以先观战', 409);
    const seat = requestedSeat ?? SEAT_ORDER.find(index => !table.players.some(player => player.seat === index));
    table.players.push({ id: user.id, name: user.name, avatar: user.avatar, seat, stack: BUY_IN, bet: 0, contribution: 0, ready: false,
      inHand: false, folded: false, allIn: false, cards: [], leaving: false, lastSeen: now(), lastAction: '', winAmount: 0, actedBet: null, reopenSize: BIG_BLIND });
    log(table, `${user.name} 加入牌桌`);
  };
  const leavePlayer = (table, player) => {
    player.leaving = true; player.ready = false;
    log(table, `${player.name} 离开牌桌`);
    transferHost(table);
    if (!playing(table) || !player.inHand) {
      table.players = table.players.filter(item => item !== player);
      cleanupLeavers(table);
    } else if (table.turnSeat === player.seat) perform(table, player, player.bet >= targetBet(table) ? 'check' : 'fold');
  };
  const sweep = () => {
    const online = onlineIds();
    for (const table of tables.values()) {
      let updated = false;
      for (const player of [...table.players]) {
        if (online.has(player.id)) player.lastSeen = now();
        else if (!player.leaving && now() - player.lastSeen >= 300000) { leavePlayer(table, player); updated = true; }
      }
      if (updated) publish(table);
    }
  };
  const sweeper = setInterval(sweep, 30000);
  sweeper.unref?.();
  return {
    state,
    create(user, { name } = {}) {
      sweep();
      if (findMembership(user.id)) throw fail('请先离开当前牌桌', 409);
      if (tables.size >= 64) throw fail('牌桌数量已满，请加入现有牌桌', 409);
      const table = { id: randomUUID(), name: (typeof name === 'string' ? name.trim() : '').slice(0, 32) || `${user.name}的牌桌`.slice(0, 32),
        hostId: user.id, phase: 'waiting', handId: null, handNumber: 0, revision: 0, buttonSeat: -1, smallBlindSeat: null, bigBlindSeat: null,
        turnSeat: null, deadline: null, board: [], deck: [], currentBet: 0, minRaise: BIG_BLIND, result: null, players: [], log: [], timer: null, updatedAt: now() };
      addPlayer(table, user); tables.set(table.id, table); publish(table);
      return state(user, table.id);
    },
    join(user, { id, seat } = {}) { const table = requireTable(id); addPlayer(table, user, seat); publish(table); return state(user, id); },
    leave(user, { id } = {}) {
      const table = requireTable(id), player = requirePlayer(table, user.id);
      leavePlayer(table, player); publish(table); return { ...state(user), table: null };
    },
    ready(user, { id, ready } = {}) {
      const table = requireTable(id), player = requirePlayer(table, user.id);
      if (playing(table)) throw fail('这手牌结束后再准备', 409);
      if (typeof ready !== 'boolean') throw fail('准备状态无效');
      if (player.stack <= 0) throw fail('筹码不足，请先补充筹码');
      player.ready = ready; publish(table); return state(user, id);
    },
    rebuy(user, { id } = {}) {
      const table = requireTable(id), player = requirePlayer(table, user.id);
      if (playing(table) || player.stack !== 0) throw fail('筹码用完后，可以在两手之间补充');
      player.stack = BUY_IN; player.ready = false; player.winAmount = 0; log(table, `${player.name} 补充 ${BUY_IN} 娱乐筹码`); publish(table); return state(user, id);
    },
    start(user, { id } = {}) {
      const table = requireTable(id);
      requirePlayer(table, user.id);
      if (table.hostId !== user.id) throw fail('只有桌主可以开始', 403);
      if (playing(table)) throw fail('这一手还未结束', 409);
      const participants = table.players.filter(player => player.ready && player.stack > 0 && !player.leaving);
      if (participants.length < 2) throw fail('至少需要两位玩家准备');
      stopTimer(table);
      table.handId = randomUUID(); table.handNumber++; table.phase = 'preflop'; table.board = []; table.deck = shuffledDeck(); table.result = null;
      table.buttonSeat = orderedAfter(participants, table.buttonSeat)[0].seat;
      table.smallBlindSeat = participants.length === 2 ? table.buttonSeat : orderedAfter(participants, table.buttonSeat)[0].seat;
      table.bigBlindSeat = orderedAfter(participants, table.smallBlindSeat)[0].seat;
      table.currentBet = BIG_BLIND; table.minRaise = BIG_BLIND;
      for (const player of table.players) {
        player.inHand = participants.includes(player); player.cards = []; player.bet = 0; player.contribution = 0;
        player.folded = false; player.allIn = false; player.actedBet = null; player.reopenSize = BIG_BLIND; player.lastAction = ''; player.winAmount = 0; player.ready = false;
      }
      const dealingOrder = orderedAfter(participants, table.buttonSeat);
      for (let round = 0; round < 2; round++) for (const player of dealingOrder) player.cards.push(table.deck.pop());
      for (const [seat, amount, label] of [[table.smallBlindSeat, SMALL_BLIND, '小盲'], [table.bigBlindSeat, BIG_BLIND, '大盲']]) {
        const player = participants.find(item => item.seat === seat); const paid = pay(player, amount); player.lastAction = `${label} ${paid}`;
      }
      log(table, `第 ${table.handNumber} 手开始 · 盲注 ${SMALL_BLIND}/${BIG_BLIND}`);
      progress(table, table.bigBlindSeat); publish(table); return state(user, id);
    },
    action(user, { id, handId, revision, action, amount } = {}) {
      const table = requireTable(id), player = requirePlayer(table, user.id);
      if (!playing(table) || handId !== table.handId || revision !== table.revision) throw fail('牌局已更新，请根据最新牌面操作', 409);
      if (table.turnSeat !== player.seat || !player.inHand || player.folded || player.stack <= 0) throw fail('还未轮到你操作', 409);
      if (table.deadline && now() >= table.deadline) {
        perform(table, player, player.bet >= targetBet(table) ? 'check' : 'fold', undefined, true); publish(table);
        throw fail('操作已超时，请查看最新牌局', 409);
      }
      perform(table, player, action, amount); publish(table); return state(user, id);
    },
    presence() { if (!closed && tables.size) changed({ type: 'arcade-changed' }); },
    close() { closed = true; clearInterval(sweeper); for (const table of tables.values()) stopTimer(table); tables.clear(); },
  };
}
