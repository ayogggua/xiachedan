import { randomInt, randomUUID } from 'node:crypto';

const DEFAULT_SMALL_BLIND = 10;
const MAX_PLAYERS = 6;
const SEAT_ORDER = [0, 3, 1, 4, 2, 5];
const RANKS = '23456789TJQKA';
const SUITS = 'shdc';
const PHASES = ['preflop', 'flop', 'turn', 'river'];
const HAND_NAMES = ['高牌', '一对', '两对', '三条', '顺子', '同花', '葫芦', '四条', '同花顺'];
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const playing = table => PHASES.includes(table.phase);
const stakes = (smallBlind, handLimit = 0) => {
  if (!Number.isSafeInteger(smallBlind) || smallBlind < 1 || smallBlind > 1000000) throw fail('底分须为 1 至 1,000,000 之间的整数');
  if (!Number.isSafeInteger(handLimit) || handLimit < 0 || handLimit > 1000) throw fail('每场手数须为 0 至 1,000 之间的整数，0 表示不限');
  return { smallBlind, bigBlind: smallBlind * 2, buyIn: smallBlind * 200, handLimit };
};
const matchComplete = table => !playing(table) && table.handLimit > 0 && table.matchHandNumber >= table.handLimit;
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

// 牌桌保留在本次进程，买入、结算和战绩由 bank 持久保存；私牌只按查看者身份投影。
export function createPoker({ bank, getUser = () => null, notify = () => {}, changed = () => {}, onlineIds = () => new Set(), now = Date.now, turnMs = 40000, runoutMs = 1100, autoMs = 700, nextHandMs = 5000 } = {}) {
  if (!bank) throw new Error('Poker requires a persistent chip bank');
  const tables = new Map();
  const invitations = new Map();
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
  const motion = (table, type, detail = {}) => {
    table.events.push({ id: ++table.eventSeq, handId: table.handId, at: now(), type, ...detail });
    if (table.events.length > 80) table.events.shift();
  };
  const collect = table => {
    const bets = table.players.filter(player => player.bet > 0).map(player => ({ seat: player.seat, amount: player.bet }));
    if (bets.length) motion(table, 'collect', { bets });
  };
  const stopTimer = table => { clearTimeout(table.timer); table.timer = null; table.deadline = null; };
  const stopNextHand = table => { clearTimeout(table.nextHandTimer); table.nextHandTimer = null; table.nextHandAt = null; };
  const readyPlayers = table => table.players.filter(player => player.ready && player.stack > 0 && !player.leaving);
  const scheduleNextHand = table => {
    if (closed || !tables.has(table.id) || !table.autoContinue || table.phase !== 'showdown' || matchComplete(table) || readyPlayers(table).length < 2) {
      stopNextHand(table); return;
    }
    if (table.nextHandTimer) return;
    table.nextHandAt = now() + nextHandMs;
    const timer = setTimeout(() => {
      if (closed || !tables.has(table.id) || table.nextHandTimer !== timer) return;
      stopNextHand(table);
      if (table.autoContinue && table.phase === 'showdown' && !matchComplete(table) && readyPlayers(table).length >= 2) beginHand(table);
      publish(table);
    }, nextHandMs);
    table.nextHandTimer = timer;
    timer.unref?.();
  };
  const transferHost = table => {
    if (!table.players.some(player => player.id === table.hostId && !player.leaving)) table.hostId = table.players.find(player => !player.leaving)?.id || null;
  };
  const cleanupLeavers = table => {
    // 当前手参与者即使已离桌也必须保留到结算，避免后来加入的旁观玩家离开时带走其底池记录。
    table.players = table.players.filter(player => {
      if (!player.leaving || (playing(table) && player.inHand)) return true;
      bank.cashout(player.id); return false;
    });
    transferHost(table);
    if (!table.players.length) { stopTimer(table); stopNextHand(table); tables.delete(table.id); }
    else scheduleNextHand(table);
  };
  const targetBet = table => capable(table).length <= 1 ? Math.max(0, ...active(table).map(player => player.bet)) : table.currentBet;
  const canRaise = (table, player) => capable(table).some(other => other.id !== player.id) && (player.actedBet === null || table.currentBet - player.actedBet >= player.reopenSize);
  const legalActions = (table, userId) => {
    const player = table.players.find(item => item.id === userId);
    const canAct = Boolean(playing(table) && player && !player.leaving && !player.autoplay && !player.folded && player.inHand && player.stack > 0 && table.turnSeat === player.seat);
    const toCall = player ? Math.min(player.stack, Math.max(0, targetBet(table) - player.bet)) : 0;
    const maxRaiseTo = player ? player.bet + player.stack : 0;
    const raise = canAct && maxRaiseTo > table.currentBet && canRaise(table, player);
    return { canAct, canCheck: canAct && toCall === 0, toCall, canRaise: raise && maxRaiseTo >= table.currentBet + table.minRaise,
      minRaiseTo: table.currentBet + table.minRaise, maxRaiseTo, canAllIn: canAct && (maxRaiseTo <= targetBet(table) || raise) };
  };
  const pay = (table, player, amount) => {
    const paid = Math.min(player.stack, amount);
    player.stack -= paid; player.bet += paid; player.contribution += paid;
    player.allIn = player.stack === 0;
    player.wasAllIn ||= player.allIn;
    if (paid) motion(table, 'bet', { seat: player.seat, amount: paid });
    return paid;
  };
  const refundUncalled = table => {
    const players = table.players.filter(player => player.inHand).sort((a, b) => b.bet - a.bet);
    if (!players.length) return;
    const refund = players[0].bet - (players[1]?.bet || 0);
    if (refund > 0) {
      const player = players[0];
      player.stack += refund; player.bet -= refund; player.contribution -= refund; player.allIn = false;
      motion(table, 'refund', { seat: player.seat, amount: refund });
      log(table, `${player.name} 收回无人跟注的 ${refund} 筹码`);
    }
  };
  const finish = (table, reason) => {
    if (!playing(table)) return;
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
    const result = { reason, winners, pots, totalPot };
    bank.settle(table, table.players.filter(player => player.inHand), result);
    collect(table);
    motion(table, 'win', { awards: winners.map(winner => ({ seat: table.players.find(player => player.id === winner.id).seat, amount: winner.amount })) });
    for (const player of table.players) {
      player.winAmount = amounts.get(player.id) || 0; player.stack += player.winAmount; player.bet = 0;
      // 本场首次准备即持续参赛；新入座旁观者和筹码归零者仍须主动准备。
      player.ready = player.inHand && player.stack > 0 && !player.leaving;
    }
    table.result = result;
    table.phase = 'showdown'; table.turnSeat = null; table.currentBet = 0;
    if (matchComplete(table)) { table.autoContinue = false; for (const player of table.players) player.ready = false; }
    for (const winner of winners) log(table, `${table.players.find(player => player.id === winner.id).name} 赢得 ${winner.amount} 筹码${reason === 'showdown' ? ` · ${winner.hand}` : ''}`);
    cleanupLeavers(table);
  };
  const nextStreet = table => {
    stopTimer(table);
    refundUncalled(table);
    if (table.phase === 'river') { finish(table, 'showdown'); return; }
    collect(table);
    const firstCard = table.board.length;
    table.phase = PHASES[PHASES.indexOf(table.phase) + 1];
    table.deck.pop(); // 每条公共牌街先烧一张牌。
    for (let count = table.phase === 'flop' ? 3 : 1; count > 0; count--) table.board.push(table.deck.pop());
    motion(table, 'board', { indices: Array.from({ length: table.board.length - firstCard }, (_, i) => firstCard + i) });
    table.currentBet = 0; table.minRaise = table.bigBlind;
    for (const player of table.players) { player.bet = 0; player.actedBet = null; player.reopenSize = table.bigBlind; if (player.inHand && !player.folded) player.lastAction = ''; }
    log(table, `${{ flop: '翻牌', turn: '转牌', river: '河牌' }[table.phase]} · ${table.board.join(' ')}`);
    progress(table, table.buttonSeat);
  };
  const progress = (table, afterSeat, resumeTurn = false) => {
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
    if (!resumeTurn) table.manualDeadline = now() + turnMs;
    const timeout = player.autoplay ? autoMs : Math.max(0, table.manualDeadline - now());
    table.deadline = now() + timeout;
    table.timer = setTimeout(() => {
      if (closed || !tables.has(table.id) || table.turnSeat !== player.seat || !playing(table)) return;
      player.autoplay = true;
      perform(table, player, player.bet >= targetBet(table) ? 'check' : 'fold', undefined, true);
      publish(table);
    }, timeout);
    table.timer.unref?.();
  };
  const perform = (table, player, action, amount, automatic = false) => {
    const target = targetBet(table);
    const owed = Math.max(0, target - player.bet);
    const maximum = player.bet + player.stack;
    let label;
    if (action === 'fold') { player.folded = true; label = '弃牌'; motion(table, 'fold', { seat: player.seat }); }
    else if (action === 'check') { if (owed) throw fail('需要跟注后才能继续'); label = '过牌'; motion(table, 'check', { seat: player.seat }); }
    else if (action === 'call') { if (!owed) throw fail('当前无需跟注，请过牌'); const paid = pay(table, player, owed); label = `${player.allIn ? '全下跟注' : '跟注'} ${paid}`; }
    else if (action === 'raise' || action === 'all-in') {
      const total = action === 'all-in' ? maximum : amount;
      if (!Number.isSafeInteger(total) || total <= player.bet || total > maximum) throw fail('下注数量无效');
      if (total <= target) {
        if (action !== 'all-in') throw fail('加注必须高于当前下注');
        pay(table, player, total - player.bet); label = `全下跟注 ${total}`;
      } else {
        if (!canRaise(table, player)) throw fail('本轮不能再加注');
        if (total < table.currentBet + table.minRaise && total !== maximum) throw fail(`至少加注到 ${table.currentBet + table.minRaise}`);
        const increase = total - table.currentBet;
        if (increase >= table.minRaise) table.minRaise = increase;
        pay(table, player, total - player.bet); table.currentBet = total; player.raised = true;
        label = `${player.allIn ? '全下' : '加注到'} ${total}`;
      }
    } else throw fail('无效的牌桌操作');
    stopTimer(table);
    player.actedBet = table.currentBet;
    player.reopenSize = table.minRaise;
    if (table.phase === 'preflop' && ['call', 'raise', 'all-in'].includes(action)) player.voluntary = true;
    player.lastAction = `${automatic ? '托管 · ' : ''}${label}`;
    log(table, `${player.name} ${player.lastAction}`);
    progress(table, player.seat);
  };
  const summary = table => ({ id: table.id, name: table.name, hostId: table.hostId, playerCount: table.players.filter(player => !player.leaving).length,
    maxPlayers: MAX_PLAYERS, phase: table.phase, smallBlind: table.smallBlind, bigBlind: table.bigBlind, handNumber: table.handNumber,
    handLimit: table.handLimit, matchHandNumber: table.matchHandNumber, matchNumber: table.matchNumber, matchComplete: matchComplete(table) });
  const view = (table, userId) => {
    const online = onlineIds();
    return { ...summary(table), buyIn: table.buyIn, handId: table.handId, revision: table.revision,
      buttonSeat: table.buttonSeat, smallBlindSeat: table.smallBlindSeat, bigBlindSeat: table.bigBlindSeat,
      turnSeat: table.turnSeat, deadline: table.deadline, turnMs, nextHandAt: table.nextHandAt, autoContinue: table.autoContinue,
      board: [...table.board], events: [...table.events], messages: [...table.messages],
      pot: table.result?.totalPot ?? table.players.reduce((total, player) => total + player.contribution, 0),
      currentBet: table.currentBet, minRaise: table.minRaise, result: table.result, log: [...table.log], actions: legalActions(table, userId),
      players: table.players.map(player => ({ id: player.id, name: player.name, avatar: player.avatar, seat: player.seat, stack: player.stack,
        bet: player.bet, contribution: player.contribution, ready: player.ready, inHand: player.inHand, folded: player.folded, allIn: player.allIn,
        leaving: player.leaving, autoplay: player.autoplay, online: online.has(player.id), cards: player.id === userId || (table.phase === 'showdown' && table.result?.reason === 'showdown' && player.inHand && !player.folded) ? [...player.cards] : null,
        cardCount: player.cards.length, lastAction: player.lastAction, winAmount: player.winAmount })) };
  };
  const state = (user, id) => {
    const seated = findMembership(user.id);
    const self = seated?.players.find(player => player.id === user.id);
    if (self) { self.lastSeen = now(); self.name = user.name; self.avatar = user.avatar; }
    const table = id ? requireTable(id) : self && !self.leaving ? seated : null;
    return { tables: [...tables.values()].map(summary), table: table ? view(table, user.id) : null,
      wallet: bank.wallet(user.id), canMint: bank.canMint(user), invitations: pendingInvitations(user.id), serverTime: now() };
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
      if (playing(existing)) throw fail('当前牌局正在进行，结束后才能换桌', 409);
    }
    if (requestedSeat !== undefined && table.players.some(player => player.seat === requestedSeat)) throw fail('这个座位已经有人了', 409);
    if (table.players.length >= MAX_PLAYERS) throw fail('牌桌已满，可以先观战', 409);
    const seat = requestedSeat ?? SEAT_ORDER.find(index => !table.players.some(player => player.seat === index));
    const stack = bank.moveSeat(user.id, table.id, table.buyIn, table.bigBlind);
    if (existing) {
      existing.players = existing.players.filter(player => player.id !== user.id);
      log(existing, `${user.name} 换桌`); cleanupLeavers(existing); publish(existing);
    }
    table.players.push({ id: user.id, name: user.name, avatar: user.avatar, seat, stack, bet: 0, contribution: 0, ready: false,
      inHand: false, folded: false, allIn: false, cards: [], leaving: false, autoplay: false, lastSeen: now(), lastAction: '', winAmount: 0, actedBet: null, reopenSize: table.bigBlind });
    log(table, `${user.name} 加入牌桌`);
  };
  const leavePlayer = (table, player) => {
    player.leaving = true; player.ready = false;
    log(table, `${player.name} 离开牌桌`);
    transferHost(table);
    if (!playing(table) || !player.inHand) {
      bank.cashout(player.id);
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
  const pendingInvitations = userId => {
    for (const [id, invite] of invitations) if (invite.expiresAt <= now() || !tables.has(invite.tableId)) invitations.delete(id);
    return [...invitations.values()].filter(invite => invite.userId === userId);
  };
  const beginHand = table => {
    const participants = readyPlayers(table);
    if (participants.length < 2) throw fail('至少需要两位玩家准备');
    stopTimer(table); stopNextHand(table); table.autoContinue = true;
    table.handId = randomUUID(); table.handNumber++; table.matchHandNumber++; table.phase = 'preflop'; table.board = []; table.deck = shuffledDeck(); table.result = null;
    table.events = [];
    table.buttonSeat = table.buttonSeat === -1 ? participants[randomInt(participants.length)].seat : orderedAfter(participants, table.buttonSeat)[0].seat;
    table.smallBlindSeat = participants.length === 2 ? table.buttonSeat : orderedAfter(participants, table.buttonSeat)[0].seat;
    table.bigBlindSeat = orderedAfter(participants, table.smallBlindSeat)[0].seat;
    table.currentBet = table.bigBlind; table.minRaise = table.bigBlind;
    for (const player of table.players) {
      player.inHand = participants.includes(player); player.cards = []; player.bet = 0; player.contribution = 0;
      player.folded = false; player.allIn = false; player.actedBet = null; player.reopenSize = table.bigBlind; player.lastAction = ''; player.winAmount = 0; player.ready = player.inHand;
      player.voluntary = false; player.raised = false; player.wasAllIn = false;
    }
    const dealingOrder = orderedAfter(participants, table.buttonSeat);
    for (let round = 0; round < 2; round++) for (const player of dealingOrder) player.cards.push(table.deck.pop());
    motion(table, 'deal', { seats: dealingOrder.map(player => player.seat) });
    for (const [seat, amount, label] of [[table.smallBlindSeat, table.smallBlind, '小盲'], [table.bigBlindSeat, table.bigBlind, '大盲']]) {
      const player = participants.find(item => item.seat === seat); const paid = pay(table, player, amount); player.lastAction = `${label} ${paid}`;
    }
    log(table, `第 ${table.handNumber} 手开始 · 盲注 ${table.smallBlind}/${table.bigBlind}`);
    progress(table, table.bigBlindSeat);
  };
  return {
    state,
    invitations(user) { return { invitations: pendingInvitations(user.id), serverTime: now() }; },
    create(user, { name, smallBlind = DEFAULT_SMALL_BLIND, handLimit = 0 } = {}) {
      sweep();
      if (playing(findMembership(user.id) || {})) throw fail('当前牌局正在进行，结束后才能新建牌桌', 409);
      if (tables.size >= 64) throw fail('牌桌数量已满，请加入现有牌桌', 409);
      const limits = stakes(smallBlind, handLimit);
      const table = { ...limits, id: randomUUID(), name: (typeof name === 'string' ? name.trim() : '').slice(0, 32) || `${user.name}的牌桌`.slice(0, 32),
        hostId: user.id, phase: 'waiting', handId: null, handNumber: 0, matchHandNumber: 0, matchNumber: 1, revision: 0, buttonSeat: -1, smallBlindSeat: null, bigBlindSeat: null,
        turnSeat: null, deadline: null, board: [], deck: [], currentBet: 0, minRaise: limits.bigBlind, result: null, players: [], log: [], events: [], eventSeq: 0, messages: [], timer: null,
        autoContinue: false, nextHandAt: null, nextHandTimer: null, updatedAt: now() };
      addPlayer(table, user); tables.set(table.id, table); publish(table);
      return state(user, table.id);
    },
    join(user, { id, seat } = {}) { const table = requireTable(id); addPlayer(table, user, seat); publish(table); return state(user, id); },
    leave(user, { id } = {}) {
      const table = requireTable(id), player = requirePlayer(table, user.id);
      if (playing(table)) throw fail('牌局正在进行，结束后才能离桌', 409);
      leavePlayer(table, player); publish(table); return { ...state(user), table: null };
    },
    ready(user, { id, ready } = {}) {
      const table = requireTable(id), player = requirePlayer(table, user.id);
      if (playing(table)) throw fail('这手牌结束后再准备', 409);
      if (matchComplete(table)) throw fail('本场已结束，等待桌主开启下一场', 409);
      if (typeof ready !== 'boolean') throw fail('准备状态无效');
      if (player.stack <= 0) throw fail('筹码不足，请先补充筹码');
      player.ready = ready; scheduleNextHand(table); publish(table); return state(user, id);
    },
    stakes(user, { id, smallBlind, handLimit } = {}) {
      const table = requireTable(id); requirePlayer(table, user.id);
      if (table.hostId !== user.id) throw fail('只有桌主可以调整牌桌设置', 403);
      if (playing(table)) throw fail('本手结束后才能调整牌桌设置', 409);
      const limits = stakes(smallBlind === undefined ? table.smallBlind : smallBlind, handLimit === undefined ? table.handLimit : handLimit);
      if (limits.smallBlind !== table.smallBlind || limits.handLimit !== table.handLimit) {
        stopNextHand(table); table.autoContinue = false;
        Object.assign(table, limits); table.minRaise = limits.bigBlind;
        for (const player of table.players) player.ready = false;
        log(table, `桌主调整牌桌：盲注 ${limits.smallBlind}/${limits.bigBlind} · ${limits.handLimit ? `每场 ${limits.handLimit} 手` : '不限手数'}，请重新准备`);
        publish(table);
      }
      return state(user, id);
    },
    newMatch(user, { id } = {}) {
      const table = requireTable(id); requirePlayer(table, user.id);
      if (table.hostId !== user.id) throw fail('只有桌主可以开启下一场', 403);
      if (table.phase === 'waiting' && table.matchHandNumber === 0) return state(user, id);
      if (!matchComplete(table)) throw fail('本场结束后才能开启下一场', 409);
      stopNextHand(table); table.autoContinue = false;
      table.matchNumber++; table.matchHandNumber = 0; table.phase = 'waiting'; table.handId = null;
      table.result = null; table.board = []; table.events = []; table.currentBet = 0; table.minRaise = table.bigBlind;
      table.smallBlindSeat = null; table.bigBlindSeat = null;
      for (const player of table.players) Object.assign(player, { ready: false, inHand: false, cards: [], bet: 0, contribution: 0, folded: false, allIn: false, winAmount: 0, lastAction: '' });
      log(table, `第 ${table.matchNumber} 场开始，请准备`); publish(table); return state(user, id);
    },
    rebuy(user, { id, amount } = {}) {
      const table = requireTable(id), player = requirePlayer(table, user.id);
      if (playing(table)) throw fail('本局结束后才能补充筹码', 409);
      amount ??= table.buyIn;
      player.stack += bank.topup(user.id, table.id, amount); player.winAmount = 0;
      log(table, `${player.name} 买入 ${amount} 筹码`); scheduleNextHand(table); publish(table); return state(user, id);
    },
    start(user, { id } = {}) {
      const table = requireTable(id);
      requirePlayer(table, user.id);
      if (table.hostId !== user.id) throw fail('只有桌主可以开始', 403);
      if (playing(table)) throw fail('这一手还未结束', 409);
      if (matchComplete(table)) throw fail('本场已结束，请先开启下一场', 409);
      beginHand(table); publish(table); return state(user, id);
    },
    action(user, { id, handId, revision, action, amount } = {}) {
      const table = requireTable(id), player = requirePlayer(table, user.id);
      if (!playing(table) || handId !== table.handId || revision !== table.revision) throw fail('牌局已更新，请根据最新牌面操作', 409);
      if (player.autoplay) throw fail('请先取消托管', 409);
      if (table.turnSeat !== player.seat || !player.inHand || player.folded || player.stack <= 0) throw fail('还未轮到你操作', 409);
      if (table.deadline && now() >= table.deadline) {
        player.autoplay = true;
        perform(table, player, player.bet >= targetBet(table) ? 'check' : 'fold', undefined, true); publish(table);
        throw fail('操作已超时，请查看最新牌局', 409);
      }
      perform(table, player, action, amount); publish(table); return state(user, id);
    },
    autoplay(user, { id, enabled } = {}) {
      const table = requireTable(id), player = requirePlayer(table, user.id);
      if (typeof enabled !== 'boolean') throw fail('托管状态无效');
      if (player.autoplay !== enabled) {
        player.autoplay = enabled;
        if (playing(table) && table.turnSeat === player.seat) progress(table, (player.seat + MAX_PLAYERS - 1) % MAX_PLAYERS, true);
        publish(table);
      }
      return state(user, id);
    },
    say(user, { id, text, requestId } = {}) {
      const table = requireTable(id), player = requirePlayer(table, user.id);
      if (typeof text !== 'string' || !text.trim() || [...text.trim()].length > 160) throw fail('消息须为 1 至 160 个字');
      if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(requestId)) throw fail('消息标识无效');
      if (table.messages.some(message => message.userId === user.id && message.requestId === requestId)) return state(user, id);
      if (player.spokeAt && now() - player.spokeAt < 1000) throw fail('发言太快，请稍候');
      player.spokeAt = now();
      table.messages.push({ id: randomUUID(), requestId, userId: user.id, name: user.name, text: text.trim(), at: now() });
      if (table.messages.length > 40) table.messages.shift();
      changed({ type: 'arcade-changed', id: table.id });
      return state(user, id);
    },
    invite(user, { id, userId } = {}) {
      const table = requireTable(id); requirePlayer(table, user.id);
      const target = typeof userId === 'string' && getUser(userId);
      if (!target || userId === user.id) throw fail('请选择其他用户');
      if (table.players.some(player => player.id === userId)) throw fail('对方已在本桌');
      if (table.players.length >= MAX_PLAYERS) throw fail('牌桌已满', 409);
      pendingInvitations(userId);
      if ([...invitations.values()].some(invite => invite.userId === userId && invite.tableId === id)) return state(user, id);
      if (invitations.size >= 1000) throw fail('邀请过多，请稍后再试', 429);
      const invite = { id: randomUUID(), userId, fromId: user.id, fromName: user.name, tableId: id, tableName: table.name, expiresAt: now() + 300000 };
      invitations.set(invite.id, invite); notify(userId, { type: 'arcade-invite', invitation: invite });
      return state(user, id);
    },
    respond(user, { invitationId, accept } = {}) {
      pendingInvitations(user.id);
      const invite = invitations.get(invitationId);
      if (!invite || invite.userId !== user.id) throw fail('邀请已失效', 404);
      if (typeof accept !== 'boolean') throw fail('邀请操作无效');
      if (accept) { const table = requireTable(invite.tableId); addPlayer(table, user); publish(table); }
      invitations.delete(invitationId);
      notify(user.id, { type: 'arcade-invitations-changed' });
      return state(user, accept ? invite.tableId : undefined);
    },
    presence() { if (!closed && tables.size) changed({ type: 'arcade-changed' }); },
    close() { closed = true; clearInterval(sweeper); for (const table of tables.values()) { stopTimer(table); stopNextHand(table); } tables.clear(); },
  };
}
