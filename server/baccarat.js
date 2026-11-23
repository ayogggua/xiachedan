import { randomInt, randomUUID } from 'node:crypto';

const RANKS = 'A23456789TJQK';
const SUITS = 'shdc';
const DECK_COUNT = 8;
const CUT_CARD_REMAINING = 14;
const MAX_HISTORY = 120;
const VISITOR_TTL_MS = 90000;
const ACTIVE_PRESENT_MS = 30000;

export const BACCARAT_SPOTS = ['banker', 'player', 'tie', 'bankerPair', 'playerPair', 'lucky6'];
const MAIN_SPOTS = new Set(['banker', 'player']);

const TABLE_PRESETS = [
  {
    id: 'macau-nc-1',
    name: '葡京免佣 1 号台',
    subtitle: '大众厅 · 免佣 / 幸运6',
    mode: 'no-commission',
    minBet: 10,
    maxBet: 50000,
    sideMaxBet: 5000,
    step: 10,
    chips: [10, 50, 100, 500, 1000, 5000],
  },
  {
    id: 'macau-nc-2',
    name: '永利免佣 2 号台',
    subtitle: '中场厅 · 免佣 / 幸运6',
    mode: 'no-commission',
    minBet: 50,
    maxBet: 100000,
    sideMaxBet: 10000,
    step: 10,
    chips: [50, 100, 500, 1000, 5000, 10000],
  },
  {
    id: 'macau-vip-1',
    name: '威尼斯人贵宾台',
    subtitle: '贵宾厅 · 免佣 / 幸运6',
    mode: 'no-commission',
    minBet: 100,
    maxBet: 500000,
    sideMaxBet: 50000,
    step: 100,
    chips: [100, 500, 1000, 5000, 10000, 50000],
  },
  {
    id: 'macau-classic-1',
    name: '新濠传统抽水台',
    subtitle: '经典厅 · 庄赢抽 5% 佣金',
    mode: 'classic',
    minBet: 20,
    maxBet: 100000,
    sideMaxBet: 10000,
    step: 20,
    chips: [20, 100, 500, 1000, 5000, 10000],
  },
];

const SUIT_LABEL = { s: '黑桃', h: '红桃', d: '方块', c: '梅花' };
const OUTCOME_LABEL = { banker: '庄赢', player: '闲赢', tie: '和局' };
const SPOT_LABEL = {
  banker: '庄',
  player: '闲',
  tie: '和',
  bankerPair: '庄对',
  playerPair: '闲对',
  lucky6: '幸运6',
};

const fail = (message, status = 400) => Object.assign(new Error(message), { status });

export function cardPoint(card) {
  const rank = card[0];
  if (rank === 'A') return 1;
  if ('TJQK'.includes(rank)) return 0;
  return Number(rank);
}

export function burnValue(card) {
  const rank = card[0];
  if (rank === 'A') return 1;
  if ('TJQK'.includes(rank)) return 10;
  return Number(rank);
}

export function handPoints(cards) {
  return cards.reduce((sum, card) => sum + cardPoint(card), 0) % 10;
}

function formatCard(card) {
  if (!card) return '';
  const rank = card[0] === 'T' ? '10' : card[0];
  return `${SUIT_LABEL[card[1]] || ''}${rank}`;
}

function buildShuffledShoe() {
  const deck = [];
  for (let d = 0; d < DECK_COUNT; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) deck.push(rank + suit);
    }
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const burnCard = deck.pop();
  const burnCount = burnValue(burnCard);
  for (let i = 0; i < burnCount; i++) deck.pop();
  return {
    cards: deck,
    total: DECK_COUNT * 52,
    burnCard,
    burnCount,
    cutAt: CUT_CARD_REMAINING,
  };
}

// 澳门标准百家乐发牌与补牌规则（Punto Banco）
export function resolveBaccaratDeal(drawCard) {
  const player = [drawCard()];
  const banker = [drawCard()];
  player.push(drawCard());
  banker.push(drawCard());

  const p2 = handPoints(player);
  const b2 = handPoints(banker);
  const natural = p2 >= 8 || b2 >= 8;

  let playerDrew = false;
  let bankerDrew = false;

  if (!natural) {
    let p3Point = null;
    if (p2 <= 5) {
      const p3 = drawCard();
      player.push(p3);
      playerDrew = true;
      p3Point = cardPoint(p3);
    }
    let bankerShouldDraw = false;
    if (!playerDrew) {
      bankerShouldDraw = b2 <= 5;
    } else if (b2 <= 2) {
      bankerShouldDraw = true;
    } else if (b2 === 3) {
      bankerShouldDraw = p3Point !== 8;
    } else if (b2 === 4) {
      bankerShouldDraw = p3Point >= 2 && p3Point <= 7;
    } else if (b2 === 5) {
      bankerShouldDraw = p3Point >= 4 && p3Point <= 7;
    } else if (b2 === 6) {
      bankerShouldDraw = p3Point >= 6 && p3Point <= 7;
    }
    if (bankerShouldDraw) {
      banker.push(drawCard());
      bankerDrew = true;
    }
  }

  const playerPoints = handPoints(player);
  const bankerPoints = handPoints(banker);
  const outcome = bankerPoints > playerPoints ? 'banker' : playerPoints > bankerPoints ? 'player' : 'tie';
  const playerPair = player[0][0] === player[1][0];
  const bankerPair = banker[0][0] === banker[1][0];
  const lucky6 = outcome === 'banker' && bankerPoints === 6;
  const lucky6Cards = lucky6 ? banker.length : 0;

  return {
    player,
    banker,
    playerPoints,
    bankerPoints,
    natural,
    playerDrew,
    bankerDrew,
    outcome,
    playerPair,
    bankerPair,
    lucky6,
    lucky6Cards,
  };
}

// 计算单注区派彩总额（含退回本金）。整数筹码配合台面步长，保证所有赔率精确无小数误差。
export function settleBetSpot(spot, stake, deal, mode = 'no-commission') {
  if (!stake || stake <= 0) return { payout: 0, profit: 0, pushed: false, won: false };
  if (spot === 'player') {
    if (deal.outcome === 'player') return { payout: stake * 2, profit: stake, pushed: false, won: true };
    if (deal.outcome === 'tie') return { payout: stake, profit: 0, pushed: true, won: false };
    return { payout: 0, profit: -stake, pushed: false, won: false };
  }
  if (spot === 'banker') {
    if (deal.outcome === 'banker') {
      if (mode === 'classic') {
        const profit = Math.floor((stake * 95) / 100);
        return { payout: stake + profit, profit, pushed: false, won: true };
      }
      if (deal.bankerPoints === 6) {
        const profit = Math.floor(stake / 2);
        return { payout: stake + profit, profit, pushed: false, won: true };
      }
      return { payout: stake * 2, profit: stake, pushed: false, won: true };
    }
    if (deal.outcome === 'tie') return { payout: stake, profit: 0, pushed: true, won: false };
    return { payout: 0, profit: -stake, pushed: false, won: false };
  }
  if (spot === 'tie') {
    if (deal.outcome === 'tie') return { payout: stake * 9, profit: stake * 8, pushed: false, won: true };
    return { payout: 0, profit: -stake, pushed: false, won: false };
  }
  if (spot === 'playerPair') {
    if (deal.playerPair) return { payout: stake * 12, profit: stake * 11, pushed: false, won: true };
    return { payout: 0, profit: -stake, pushed: false, won: false };
  }
  if (spot === 'bankerPair') {
    if (deal.bankerPair) return { payout: stake * 12, profit: stake * 11, pushed: false, won: true };
    return { payout: 0, profit: -stake, pushed: false, won: false };
  }
  if (spot === 'lucky6' && mode === 'no-commission') {
    if (deal.lucky6) {
      const mult = deal.lucky6Cards === 3 ? 20 : 12;
      return { payout: stake * (mult + 1), profit: stake * mult, pushed: false, won: true };
    }
    return { payout: 0, profit: -stake, pushed: false, won: false };
  }
  return { payout: 0, profit: -stake, pushed: false, won: false };
}

export function createBaccarat({
  bank,
  getUser = () => null,
  notify = () => {},
  changed = () => {},
  onlineIds = () => new Set(),
  now = Date.now,
  bettingMs = 15000,
  revealStepMs = 820,
  squeezeMs = 14000,
  settledMs = 4000,
} = {}) {
  if (!bank) throw new Error('Baccarat requires a persistent chip bank');

  const tables = new Map();
  const invitations = new Map();
  let closed = false;

  const log = (table, text) => {
    table.log.push({ id: randomUUID(), at: now(), text });
    if (table.log.length > 50) table.log.shift();
  };

  const publish = table => {
    if (closed) return;
    if (table) {
      table.revision++;
      table.updatedAt = now();
    }
    changed({ type: 'arcade-changed', game: 'baccarat', ...(table ? { id: table.id } : {}) });
  };

  const clearTimers = table => {
    for (const timer of table.timers) clearTimeout(timer);
    table.timers.clear();
  };

  const schedule = (table, ms, fn) => {
    const timer = setTimeout(() => {
      table.timers.delete(timer);
      if (closed) return;
      fn();
    }, ms);
    timer.unref?.();
    table.timers.add(timer);
    return timer;
  };

  const openFreshShoe = (table, initial = false) => {
    table.shoeNumber++;
    table.roundNumber = 0;
    table.history = [];
    table.shoe = buildShuffledShoe();
    log(
      table,
      `${initial ? '开台' : '切牌换靴'} · 第 ${table.shoeNumber} 靴，首牌 ${formatCard(table.shoe.burnCard)} 销牌 ${table.shoe.burnCount} 张`,
    );
  };

  for (const preset of TABLE_PRESETS) {
    const table = {
      ...preset,
      shoeNumber: 0,
      roundNumber: 0,
      roundId: randomUUID(),
      phase: 'open', // open 等待落注 | betting 下注倒计时 | dealing 派牌开牌 | settled 结算派彩
      revision: 0,
      bettingEndsAt: null,
      phaseEndsAt: null,
      shoe: null,
      history: [],
      deal: null,
      dealSteps: [],
      squeeze: null,
      squeezePrefs: new Map(), // userId -> boolean (默认 true 开启咪牌)
      revealPlayer: 0,
      revealBanker: 0,
      result: null,
      bets: new Map(), // userId -> { spots: { ... }, total, history: [{ entries: [{ spot, amount }] }], name, avatar }
      lastBetsByUser: new Map(), // userId -> { spot: amount }
      confirmedIds: new Set(),
      processedRequests: new Set(),
      visitors: new Map(), // userId -> { id, name, avatar, lastSeen }
      messages: [],
      spokeAt: new Map(),
      log: [],
      timers: new Set(),
      updatedAt: now(),
    };
    openFreshShoe(table, true);
    tables.set(table.id, table);
  }

  const requireTable = id => {
    const table = typeof id === 'string' && tables.get(id);
    if (!table) throw fail('找不到这张百家乐牌桌', 404);
    return table;
  };

  const allowedSpots = table => (table.mode === 'no-commission' ? BACCARAT_SPOTS : BACCARAT_SPOTS.filter(s => s !== 'lucky6'));

  const touchVisitor = (table, user) => {
    table.visitors.set(user.id, { id: user.id, name: user.name, avatar: user.avatar, lastSeen: now() });
  };

  const presentUsers = table => {
    const online = onlineIds();
    const cutoff = now() - ACTIVE_PRESENT_MS;
    const ids = new Set();
    for (const [userId, visitor] of table.visitors) {
      if (visitor.lastSeen >= cutoff && (!online.size || online.has(userId))) ids.add(userId);
    }
    for (const userId of table.bets.keys()) ids.add(userId);
    return ids;
  };

  const spotLimit = (table, spot) => (MAIN_SPOTS.has(spot) ? table.maxBet : table.sideMaxBet);

  const validateEntries = (table, userId, entries) => {
    if (!Array.isArray(entries) || !entries.length) throw fail('请选择下注区域和筹码');
    const allowed = new Set(allowedSpots(table));
    const current = table.bets.get(userId)?.spots || {};
    const projected = { ...current };
    let addedTotal = 0;

    for (const entry of entries) {
      const { spot, amount } = entry || {};
      if (typeof spot !== 'string' || !allowed.has(spot)) throw fail('无效的下注区域');
      if (!Number.isSafeInteger(amount) || amount <= 0) throw fail('下注筹码数量无效');
      if (amount % table.step !== 0) throw fail(`本桌下注须为 ${table.step} 的整数倍`);
      const prev = projected[spot] || 0;
      const next = prev + amount;
      if (prev === 0 && next < table.minBet) throw fail(`单注最低 ${table.minBet.toLocaleString('zh-CN')} 筹码`);
      const max = spotLimit(table, spot);
      if (next > max) throw fail(`${SPOT_LABEL[spot]}区限红 ${max.toLocaleString('zh-CN')} 筹码`);
      projected[spot] = next;
      addedTotal += amount;
    }

    if ((projected.banker || 0) > 0 && (projected.player || 0) > 0) {
      throw fail('同局不能同时押庄和闲');
    }

    return { projected, addedTotal };
  };

  const applyBetEntries = (table, user, entries, requestId) => {
    if (!['open', 'betting'].includes(table.phase)) throw fail('买定离手，本局已停止下注', 409);
    if (table.phase === 'betting' && table.bettingEndsAt && now() >= table.bettingEndsAt) {
      beginDealing(table);
      publish(table);
      throw fail('买定离手，本局已停止下注', 409);
    }
    if (requestId) {
      if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(requestId)) throw fail('请求标识无效');
      const reqKey = `${user.id}:${requestId}`;
      if (table.processedRequests.has(reqKey)) return false;
    }

    const { projected, addedTotal } = validateEntries(table, user.id, entries);
    bank.holdBaccaratBet(user.id, table.id, table.roundId, addedTotal);

    if (requestId) table.processedRequests.add(`${user.id}:${requestId}`);
    let record = table.bets.get(user.id);
    if (!record) {
      record = { spots: {}, total: 0, history: [], name: user.name, avatar: user.avatar };
      table.bets.set(user.id, record);
    }
    record.name = user.name;
    record.avatar = user.avatar;
    record.spots = projected;
    record.total += addedTotal;
    record.history.push({ entries: entries.map(({ spot, amount }) => ({ spot, amount })), total: addedTotal });
    table.confirmedIds.delete(user.id);

    if (table.phase === 'open') {
      table.phase = 'betting';
      table.bettingEndsAt = now() + bettingMs;
      table.phaseEndsAt = table.bettingEndsAt;
      clearTimers(table);
      schedule(table, bettingMs, () => {
        if (table.phase === 'betting') {
          beginDealing(table);
          publish(table);
        }
      });
    }
    return true;
  };

  const settleRound = table => {
    if (table.phase !== 'dealing' || !table.deal) return;
    clearTimers(table);
    const deal = table.deal;
    table.revealPlayer = deal.player.length;
    table.revealBanker = deal.banker.length;

    const winningSpots = [];
    winningSpots.push(deal.outcome);
    if (deal.playerPair) winningSpots.push('playerPair');
    if (deal.bankerPair) winningSpots.push('bankerPair');
    if (deal.lucky6 && table.mode === 'no-commission') winningSpots.push('lucky6');

    const settlements = [];
    const playerResults = [];
    let totalWagered = 0;
    let totalPayout = 0;

    for (const [userId, record] of table.bets) {
      let payout = 0;
      let wonBanker = false;
      let wonPlayer = false;
      let wonTie = false;
      let wonPair = false;
      let wonLucky6 = false;
      const spotResults = {};

      for (const [spot, stake] of Object.entries(record.spots)) {
        if (!stake) continue;
        const r = settleBetSpot(spot, stake, deal, table.mode);
        payout += r.payout;
        spotResults[spot] = { stake, payout: r.payout, profit: r.profit, pushed: r.pushed, won: r.won };
        if (r.won) {
          if (spot === 'banker') wonBanker = true;
          else if (spot === 'player') wonPlayer = true;
          else if (spot === 'tie') wonTie = true;
          else if (spot === 'bankerPair' || spot === 'playerPair') wonPair = true;
          else if (spot === 'lucky6') wonLucky6 = true;
        }
      }

      const wagered = record.total;
      const net = payout - wagered;
      totalWagered += wagered;
      totalPayout += payout;

      const outcomeText = deal.lucky6 && table.mode === 'no-commission'
        ? `庄6点(${deal.lucky6Cards}张)`
        : `${OUTCOME_LABEL[deal.outcome]} 闲${deal.playerPoints}庄${deal.bankerPoints}`;

      settlements.push({
        userId,
        wagered,
        payout,
        net,
        wonBanker,
        wonPlayer,
        wonTie,
        wonPair,
        wonLucky6,
        note: `${table.name} · 第${table.shoeNumber}靴第${table.roundNumber}局（${outcomeText}）`,
      });
      playerResults.push({
        userId,
        name: record.name,
        avatar: record.avatar,
        wagered,
        payout,
        net,
        spotResults,
      });

      // 保存该玩家本局注单以供下一局「续押」
      const saved = {};
      for (const [spot, stake] of Object.entries(record.spots)) {
        if (stake > 0) saved[spot] = stake;
      }
      if (Object.keys(saved).length) table.lastBetsByUser.set(userId, saved);
    }

    bank.settleBaccarat(
      {
        roundId: table.roundId,
        tableId: table.id,
        shoeNumber: table.shoeNumber,
        roundNumber: table.roundNumber,
        outcome: deal.outcome,
        totalWagered,
        totalPayout,
        note: `${table.name} · 第${table.shoeNumber}靴第${table.roundNumber}局`,
      },
      settlements,
    );

    table.history.push({
      r: table.roundNumber,
      o: deal.outcome,
      pp: deal.playerPair,
      bp: deal.bankerPair,
      l6: table.mode === 'no-commission' ? deal.lucky6Cards : 0,
      pPts: deal.playerPoints,
      bPts: deal.bankerPoints,
      nat: deal.natural,
    });
    if (table.history.length > MAX_HISTORY) table.history.shift();

    const tags = [];
    if (deal.natural) tags.push('例牌');
    if (deal.playerPair) tags.push('闲对');
    if (deal.bankerPair) tags.push('庄对');
    if (deal.lucky6 && table.mode === 'no-commission') tags.push(`幸运6(${deal.lucky6Cards}张)`);

    table.result = {
      roundId: table.roundId,
      roundNumber: table.roundNumber,
      outcome: deal.outcome,
      playerPoints: deal.playerPoints,
      bankerPoints: deal.bankerPoints,
      natural: deal.natural,
      playerPair: deal.playerPair,
      bankerPair: deal.bankerPair,
      lucky6: deal.lucky6 && table.mode === 'no-commission',
      lucky6Cards: deal.lucky6 && table.mode === 'no-commission' ? deal.lucky6Cards : 0,
      winningSpots,
      totalWagered,
      totalPayout,
      players: playerResults.sort((a, b) => b.net - a.net || b.wagered - a.wagered),
    };
    table.phase = 'settled';
    table.phaseEndsAt = now() + settledMs;

    log(
      table,
      `第 ${table.roundNumber} 局 · 闲 ${deal.playerPoints} 点 / 庄 ${deal.bankerPoints} 点 · ${OUTCOME_LABEL[deal.outcome]}${tags.length ? `（${tags.join('、')}）` : ''}`,
    );

    schedule(table, settledMs, () => {
      if (table.phase !== 'settled') return;
      resetForNextRound(table);
      publish(table);
    });
  };

  const resetForNextRound = table => {
    clearTimers(table);
    table.phase = 'open';
    table.bettingEndsAt = null;
    table.phaseEndsAt = null;
    table.deal = null;
    table.dealSteps = [];
    table.squeeze = null;
    table.revealPlayer = 0;
    table.revealBanker = 0;
    table.result = null;
    table.bets.clear();
    table.confirmedIds.clear();
    table.processedRequests.clear();
    table.roundId = randomUUID();
    if (table.shoe.cards.length <= table.shoe.cutAt) {
      openFreshShoe(table, false);
    }
  };

  const wantsSqueeze = (table, userId) => table.squeezePrefs.get(userId) !== false;

  // 澳门规则：押闲最高注者咪闲牌，押庄最高注者咪庄牌；若仅押边注，则由总注最高者咪庄牌。
  const pickSqueezer = (table, side) => {
    const present = presentUsers(table);
    let bestId = null;
    let bestAmount = 0;
    for (const [uid, record] of table.bets) {
      const amount = record.spots[side] || 0;
      if (amount <= 0) continue;
      if (!wantsSqueeze(table, uid) || !present.has(uid)) continue;
      if (amount > bestAmount) {
        bestAmount = amount;
        bestId = uid;
      }
    }
    return bestId;
  };

  const pickFallbackSqueezer = table => {
    const present = presentUsers(table);
    let bestId = null;
    let bestAmount = 0;
    for (const [uid, record] of table.bets) {
      if (record.total <= 0) continue;
      if (!wantsSqueeze(table, uid) || !present.has(uid)) continue;
      if (record.total > bestAmount) {
        bestAmount = record.total;
        bestId = uid;
      }
    }
    return bestId;
  };

  const commitDealReveal = (table, step) => {
    if (step.side === 'player') table.revealPlayer = step.targetReveal;
    else if (step.side === 'banker') table.revealBanker = step.targetReveal;
  };

  const afterSqueezeMs = Math.min(480, Math.round(revealStepMs * 0.6));
  const beforeSettleMs = Math.min(620, Math.round(revealStepMs * 0.75));

  const advanceDealStep = table => {
    if (table.phase !== 'dealing' || !table.deal) return;
    clearTimers(table);
    table.squeeze = null;

    if (!table.dealSteps.length) {
      table.phaseEndsAt = now() + beforeSettleMs;
      schedule(table, beforeSettleMs, () => {
        if (table.phase === 'dealing') {
          settleRound(table);
          publish(table);
        }
      });
      return;
    }

    const step = table.dealSteps.shift();
    const squeezerId = step.squeezerId && wantsSqueeze(table, step.squeezerId) && table.visitors.has(step.squeezerId)
      ? step.squeezerId
      : null;

    if (squeezerId) {
      const duration = step.cards.length > 1 ? squeezeMs : Math.max(9000, Math.round(squeezeMs * 0.85));
      const profile = getUser(squeezerId);
      const record = table.bets.get(squeezerId);
      const endsAt = now() + duration;
      table.squeeze = {
        step: step.step,
        side: step.side,
        targetReveal: step.targetReveal,
        cards: step.cards,
        userId: squeezerId,
        userName: profile?.name || record?.name || '玩家',
        endsAt,
      };
      table.phaseEndsAt = endsAt;
      schedule(table, duration, () => {
        if (table.phase === 'dealing' && table.squeeze?.step === step.step) {
          completeSqueezeStep(table, step);
          publish(table);
        }
      });
      return;
    }

    commitDealReveal(table, step);
    const hasMore = table.dealSteps.length > 0;
    const delay = hasMore ? revealStepMs : beforeSettleMs;
    table.phaseEndsAt = now() + delay;
    schedule(table, delay, () => {
      if (table.phase !== 'dealing') return;
      if (hasMore) advanceDealStep(table);
      else settleRound(table);
      publish(table);
    });
  };

  const completeSqueezeStep = (table, stepOverride = null) => {
    if (table.phase !== 'dealing' || !table.deal) return;
    const current = stepOverride || table.squeeze;
    if (!current) return;
    clearTimers(table);
    commitDealReveal(table, current);
    table.squeeze = null;
    const hasMore = table.dealSteps.length > 0;
    const delay = hasMore ? afterSqueezeMs : beforeSettleMs;
    table.phaseEndsAt = now() + delay;
    schedule(table, delay, () => {
      if (table.phase !== 'dealing') return;
      if (hasMore) advanceDealStep(table);
      else settleRound(table);
      publish(table);
    });
  };

  const beginDealing = table => {
    if (table.phase !== 'betting') return;
    clearTimers(table);
    if (!table.bets.size) {
      table.phase = 'open';
      table.bettingEndsAt = null;
      table.phaseEndsAt = null;
      return;
    }
    if (table.shoe.cards.length < 6) openFreshShoe(table, false);
    table.roundNumber++;
    table.phase = 'dealing';
    table.bettingEndsAt = null;
    table.result = null;
    table.squeeze = null;
    table.revealPlayer = 0;
    table.revealBanker = 0;
    const deal = resolveBaccaratDeal(() => table.shoe.cards.pop());
    table.deal = deal;

    let playerSqueezer = pickSqueezer(table, 'player');
    let bankerSqueezer = pickSqueezer(table, 'banker');
    if (!playerSqueezer && !bankerSqueezer) {
      bankerSqueezer = pickFallbackSqueezer(table);
    }

    const steps = [
      { step: 1, side: 'player', targetReveal: 2, cards: [deal.player[0], deal.player[1]], squeezerId: playerSqueezer },
      { step: 2, side: 'banker', targetReveal: 2, cards: [deal.banker[0], deal.banker[1]], squeezerId: bankerSqueezer },
    ];
    if (deal.playerDrew) {
      steps.push({ step: 3, side: 'player', targetReveal: 3, cards: [deal.player[2]], squeezerId: playerSqueezer });
    }
    if (deal.bankerDrew) {
      steps.push({ step: 4, side: 'banker', targetReveal: 3, cards: [deal.banker[2]], squeezerId: bankerSqueezer });
    }
    table.dealSteps = steps;
    advanceDealStep(table);
  };

  const sweep = () => {
    const online = onlineIds();
    const cutoff = now() - VISITOR_TTL_MS;
    const offlineCutoff = now() - 20000;
    for (const table of tables.values()) {
      let changedPresence = false;
      for (const [userId, visitor] of [...table.visitors]) {
        if (table.bets.has(userId)) continue;
        const stale = visitor.lastSeen < cutoff || (online.size > 0 && !online.has(userId) && visitor.lastSeen < offlineCutoff);
        if (stale) {
          table.visitors.delete(userId);
          table.confirmedIds.delete(userId);
          changedPresence = true;
        }
      }
      if (changedPresence) publish(table);
    }
  };
  const sweeper = setInterval(sweep, 30000);
  sweeper.unref?.();

  const pendingInvitations = userId => {
    for (const [id, invite] of invitations) {
      if (invite.expiresAt <= now() || !tables.has(invite.tableId)) invitations.delete(id);
    }
    return [...invitations.values()].filter(invite => invite.userId === userId);
  };

  const summary = table => {
    const activeIds = new Set([...table.visitors.keys(), ...table.bets.keys()]);
    let bankerCount = 0, playerCount = 0, tieCount = 0;
    for (const h of table.history) {
      if (h.o === 'banker') bankerCount++;
      else if (h.o === 'player') playerCount++;
      else if (h.o === 'tie') tieCount++;
    }
    return {
      id: table.id,
      game: 'baccarat',
      name: table.name,
      subtitle: table.subtitle,
      mode: table.mode,
      minBet: table.minBet,
      maxBet: table.maxBet,
      sideMaxBet: table.sideMaxBet,
      step: table.step,
      chips: table.chips,
      phase: table.phase,
      bettingEndsAt: table.bettingEndsAt,
      shoeNumber: table.shoeNumber,
      roundNumber: table.roundNumber,
      cardsRemaining: table.shoe.cards.length,
      shoeTotal: table.shoe.total,
      cutAt: table.shoe.cutAt,
      playerCount: activeIds.size,
      bettorCount: table.bets.size,
      stats: { total: table.history.length, banker: bankerCount, player: playerCount, tie: tieCount },
      recentHistory: table.history.slice(-36),
    };
  };

  const view = (table, userId) => {
    const online = onlineIds();
    const spots = {};
    for (const spot of allowedSpots(table)) {
      spots[spot] = { total: 0, count: 0, mine: 0 };
    }
    let tableTotalBet = 0;
    for (const [uid, record] of table.bets) {
      tableTotalBet += record.total;
      for (const [spot, amount] of Object.entries(record.spots)) {
        if (!amount || !spots[spot]) continue;
        spots[spot].total += amount;
        spots[spot].count++;
        if (uid === userId) spots[spot].mine = amount;
      }
    }

    const myRecord = table.bets.get(userId);
    const myBets = myRecord ? { ...myRecord.spots } : {};
    const myTotalBet = myRecord?.total || 0;
    const lastBets = table.lastBetsByUser.get(userId) || null;

    // 仅暴露已经翻开的牌，防止客户端提前读取未开牌面；咪牌牌面仅向当前咪牌人下发
    let playerCards = [];
    let bankerCards = [];
    let playerCardSlots = 0;
    let bankerCardSlots = 0;
    if (table.deal) {
      playerCards = table.deal.player.slice(0, table.revealPlayer);
      bankerCards = table.deal.banker.slice(0, table.revealBanker);
      playerCardSlots = Math.max(2, table.revealPlayer, table.squeeze?.side === 'player' ? table.squeeze.targetReveal : 0);
      bankerCardSlots = Math.max(2, table.revealBanker, table.squeeze?.side === 'banker' ? table.squeeze.targetReveal : 0);
    }

    const squeeze = table.squeeze ? {
      step: table.squeeze.step,
      side: table.squeeze.side,
      isThirdCard: table.squeeze.targetReveal === 3,
      cardCount: table.squeeze.cards.length,
      userId: table.squeeze.userId,
      userName: table.squeeze.userName,
      endsAt: table.squeeze.endsAt,
      isMine: table.squeeze.userId === userId,
      ...(table.squeeze.userId === userId ? { cards: [...table.squeeze.cards] } : {}),
    } : null;

    const playerPoints = playerCards.length ? handPoints(playerCards) : null;
    const bankerPoints = bankerCards.length ? handPoints(bankerCards) : null;

    const resultMap = new Map((table.result?.players || []).map(item => [item.userId, item]));
    const participantIds = new Set([...table.visitors.keys(), ...table.bets.keys()]);
    const players = [...participantIds].map(uid => {
      const visitor = table.visitors.get(uid);
      const betRec = table.bets.get(uid);
      const res = resultMap.get(uid);
      const profile = getUser(uid);
      return {
        id: uid,
        name: profile?.name || betRec?.name || visitor?.name || '玩家',
        avatar: profile?.avatar || betRec?.avatar || visitor?.avatar || '',
        online: online.has(uid),
        betTotal: betRec?.total || 0,
        bets: betRec ? { ...betRec.spots } : {},
        confirmed: table.confirmedIds.has(uid),
        net: res ? res.net : null,
        payout: res ? res.payout : null,
      };
    }).sort((a, b) => Number(b.id === userId) - Number(a.id === userId) || b.betTotal - a.betTotal || a.id.localeCompare(b.id));

    const present = presentUsers(table);
    const myResult = resultMap.get(userId) || null;

    return {
      ...summary(table),
      roundId: table.roundId,
      revision: table.revision,
      bettingMs,
      phaseEndsAt: table.phaseEndsAt,
      burnCard: table.shoe.burnCard,
      burnCount: table.shoe.burnCount,
      allowedSpots: allowedSpots(table),
      spots,
      tableTotalBet,
      myBets,
      myTotalBet,
      canUndo: Boolean(table.phase === 'betting' && myRecord?.history.length),
      canClear: Boolean(table.phase === 'betting' && myTotalBet > 0),
      canRebet: Boolean(['open', 'betting'].includes(table.phase) && lastBets && Object.keys(lastBets).length > 0),
      canDouble: Boolean(table.phase === 'betting' && myTotalBet > 0),
      myConfirmed: table.confirmedIds.has(userId),
      confirmedCount: table.confirmedIds.size,
      presentCount: present.size,
      lastBets,
      playerCards,
      bankerCards,
      playerCardSlots,
      bankerCardSlots,
      playerPoints,
      bankerPoints,
      squeeze,
      squeezeMs,
      mySqueezeEnabled: wantsSqueeze(table, userId),
      result: table.result,
      myResult,
      history: table.history,
      players,
      messages: [...table.messages],
      log: [...table.log],
    };
  };

  const state = (user, id) => {
    let table = null;
    if (id) {
      table = requireTable(id);
      touchVisitor(table, user);
    }
    return {
      tables: [...tables.values()].map(summary),
      table: table ? view(table, user.id) : null,
      wallet: bank.wallet(user.id),
      canMint: bank.canMint(user),
      serverTime: now(),
    };
  };

  return {
    listSummaries() {
      return [...tables.values()].map(summary);
    },
    state,
    invitations(user) {
      return { invitations: pendingInvitations(user.id), serverTime: now() };
    },
    hasInvitation(invitationId) {
      return invitations.has(invitationId);
    },
    bet(user, { id, spot, amount, requestId } = {}) {
      const table = requireTable(id);
      touchVisitor(table, user);
      const changedState = applyBetEntries(table, user, [{ spot, amount }], requestId);
      if (changedState) publish(table);
      return state(user, table.id);
    },
    rebet(user, { id, requestId } = {}) {
      const table = requireTable(id);
      touchVisitor(table, user);
      const last = table.lastBetsByUser.get(user.id);
      if (!last || !Object.keys(last).length) throw fail('上一局没有可续押的注单');
      const entries = Object.entries(last)
        .filter(([, amount]) => amount > 0)
        .map(([spot, amount]) => ({ spot, amount }));
      const changedState = applyBetEntries(table, user, entries, requestId);
      if (changedState) publish(table);
      return state(user, table.id);
    },
    double(user, { id, requestId } = {}) {
      const table = requireTable(id);
      touchVisitor(table, user);
      const record = table.bets.get(user.id);
      if (!record || !record.total) throw fail('请先下注后再加倍');
      const entries = Object.entries(record.spots)
        .filter(([, amount]) => amount > 0)
        .map(([spot, amount]) => ({ spot, amount }));
      const changedState = applyBetEntries(table, user, entries, requestId);
      if (changedState) publish(table);
      return state(user, table.id);
    },
    undo(user, { id } = {}) {
      const table = requireTable(id);
      touchVisitor(table, user);
      if (table.phase !== 'betting') throw fail('当前无法撤销下注', 409);
      if (table.bettingEndsAt && now() >= table.bettingEndsAt) {
        beginDealing(table);
        publish(table);
        throw fail('买定离手，本局已停止下注', 409);
      }
      const record = table.bets.get(user.id);
      if (!record || !record.history.length) throw fail('没有可撤销的下注');
      const lastStep = record.history[record.history.length - 1];
      bank.releaseBaccaratBet(user.id, table.id, table.roundId, lastStep.total);
      record.history.pop();
      for (const { spot, amount } of lastStep.entries) {
        record.spots[spot] = Math.max(0, (record.spots[spot] || 0) - amount);
        if (!record.spots[spot]) delete record.spots[spot];
      }
      record.total -= lastStep.total;
      if (record.total <= 0) {
        table.bets.delete(user.id);
        table.confirmedIds.delete(user.id);
      }
      if (!table.bets.size) {
        clearTimers(table);
        table.phase = 'open';
        table.bettingEndsAt = null;
        table.phaseEndsAt = null;
        table.confirmedIds.clear();
      }
      publish(table);
      return state(user, table.id);
    },
    clear(user, { id } = {}) {
      const table = requireTable(id);
      touchVisitor(table, user);
      if (table.phase !== 'betting') throw fail('当前无法清空下注', 409);
      if (table.bettingEndsAt && now() >= table.bettingEndsAt) {
        beginDealing(table);
        publish(table);
        throw fail('买定离手，本局已停止下注', 409);
      }
      const record = table.bets.get(user.id);
      if (!record || record.total <= 0) return state(user, table.id);
      bank.releaseBaccaratBet(user.id, table.id, table.roundId, record.total);
      table.bets.delete(user.id);
      table.confirmedIds.delete(user.id);
      if (!table.bets.size) {
        clearTimers(table);
        table.phase = 'open';
        table.bettingEndsAt = null;
        table.phaseEndsAt = null;
        table.confirmedIds.clear();
      }
      publish(table);
      return state(user, table.id);
    },
    deal(user, { id } = {}) {
      const table = requireTable(id);
      touchVisitor(table, user);
      if (table.phase !== 'betting') throw fail('当前不在下注阶段', 409);
      if (!table.bets.has(user.id)) throw fail('请先下注后再开牌');
      table.confirmedIds.add(user.id);
      const present = presentUsers(table);
      const allConfirmed = [...present].every(uid => table.confirmedIds.has(uid));
      if (allConfirmed) beginDealing(table);
      publish(table);
      return state(user, table.id);
    },
    reveal(user, { id, roundId, step } = {}) {
      const table = requireTable(id);
      touchVisitor(table, user);
      if (table.phase !== 'dealing' || !table.squeeze) return state(user, table.id);
      if (roundId && roundId !== table.roundId) return state(user, table.id);
      if (step !== undefined && step !== table.squeeze.step) return state(user, table.id);
      if (table.squeeze.userId !== user.id) throw fail('当前由其他玩家咪牌', 403);
      completeSqueezeStep(table);
      publish(table);
      return state(user, table.id);
    },
    squeeze(user, { id, enabled } = {}) {
      const table = requireTable(id);
      touchVisitor(table, user);
      if (typeof enabled !== 'boolean') throw fail('咪牌设置无效');
      table.squeezePrefs.set(user.id, enabled);
      if (!enabled && table.phase === 'dealing' && table.squeeze?.userId === user.id) {
        completeSqueezeStep(table);
      }
      publish(table);
      return state(user, table.id);
    },
    leave(user, { id } = {}) {
      if (id && tables.has(id)) {
        const table = tables.get(id);
        const removed = table.visitors.delete(user.id);
        table.confirmedIds.delete(user.id);
        let advanced = false;
        if (table.phase === 'dealing' && table.squeeze?.userId === user.id) {
          completeSqueezeStep(table);
          advanced = true;
        }
        if (table.phase === 'betting' && table.bets.size > 0) {
          const present = presentUsers(table);
          if (present.size > 0 && [...present].every(uid => table.confirmedIds.has(uid))) {
            beginDealing(table);
            advanced = true;
          }
        }
        if (removed || advanced) publish(table);
      }
      return state(user);
    },
    say(user, { id, text, requestId } = {}) {
      const table = requireTable(id);
      touchVisitor(table, user);
      if (typeof text !== 'string' || !text.trim() || [...text.trim()].length > 160) throw fail('消息须为 1 至 160 个字');
      if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(requestId)) throw fail('消息标识无效');
      if (table.messages.some(message => message.userId === user.id && message.requestId === requestId)) return state(user, table.id);
      const lastSpoke = table.spokeAt.get(user.id);
      if (lastSpoke && now() - lastSpoke < 1000) throw fail('发言太快，请稍候');
      table.spokeAt.set(user.id, now());
      table.messages.push({ id: randomUUID(), requestId, userId: user.id, name: user.name, text: text.trim(), at: now() });
      if (table.messages.length > 40) table.messages.shift();
      publish(table);
      return state(user, table.id);
    },
    invite(user, { id, userId } = {}) {
      const table = requireTable(id);
      touchVisitor(table, user);
      const target = typeof userId === 'string' && getUser(userId);
      if (!target || userId === user.id) throw fail('请选择其他用户');
      pendingInvitations(userId);
      if ([...invitations.values()].some(invite => invite.userId === userId && invite.tableId === id)) return state(user, table.id);
      if (invitations.size >= 1000) throw fail('邀请过多，请稍后再试', 429);
      const invite = {
        id: randomUUID(),
        game: 'baccarat',
        userId,
        fromId: user.id,
        fromName: user.name,
        tableId: id,
        tableName: table.name,
        expiresAt: now() + 300000,
      };
      invitations.set(invite.id, invite);
      notify(userId, { type: 'arcade-invite', invitation: invite });
      return state(user, table.id);
    },
    respond(user, { invitationId, accept } = {}) {
      pendingInvitations(user.id);
      const invite = invitations.get(invitationId);
      if (!invite || invite.userId !== user.id) throw fail('邀请已失效', 404);
      if (typeof accept !== 'boolean') throw fail('邀请操作无效');
      invitations.delete(invitationId);
      notify(user.id, { type: 'arcade-invitations-changed' });
      if (accept) {
        const table = requireTable(invite.tableId);
        touchVisitor(table, user);
        publish(table);
        return { ...state(user, table.id), game: 'baccarat', invitations: pendingInvitations(user.id) };
      }
      return { ...state(user), game: 'baccarat', invitations: pendingInvitations(user.id) };
    },
    presence() {
      if (closed) return;
      for (const table of tables.values()) {
        if (table.visitors.size || table.bets.size) {
          changed({ type: 'arcade-changed', game: 'baccarat', id: table.id });
          break;
        }
      }
    },
    close() {
      closed = true;
      clearInterval(sweeper);
      for (const table of tables.values()) clearTimers(table);
    },
  };
}
