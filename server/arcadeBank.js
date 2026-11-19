import { randomUUID } from 'node:crypto';

export const INITIAL_CHIPS = 200000;
const MAX_AMOUNT = 1000000000;
const MAX_BALANCE = 1000000000000;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

export function createArcadeBank({ db, userById, listUsers, canMint, now = Date.now }) {
  const stmt = sql => db.prepare(sql);
  const transaction = fn => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const ledger = (userId, kind, amount, { id = randomUUID(), peerId = null, actorId = null, note = '' } = {}) =>
    stmt('INSERT INTO arcade_ledger VALUES (?,?,?,?,?,?,?,?)').run(id, userId, kind, amount, peerId, actorId, note, now());
  const ensure = userId => {
    if (stmt('INSERT OR IGNORE INTO arcade_wallets VALUES (?,?,?)').run(userId, INITIAL_CHIPS, now()).changes) ledger(userId, 'initial', INITIAL_CHIPS);
    stmt('INSERT OR IGNORE INTO arcade_stats (user_id) VALUES (?)').run(userId);
  };
  const wallet = userId => {
    transaction(() => ensure(userId));
    const balance = stmt('SELECT balance FROM arcade_wallets WHERE user_id=?').get(userId).balance;
    const reserved = stmt('SELECT amount FROM arcade_escrow WHERE user_id=?').get(userId)?.amount || 0;
    return { balance, reserved, total: balance + reserved, initial: INITIAL_CHIPS };
  };
  const addBalance = (userId, delta) => {
    const result = stmt('UPDATE arcade_wallets SET balance=balance+? WHERE user_id=? AND balance+? BETWEEN 0 AND ?').run(delta, userId, delta, MAX_BALANCE);
    if (!result.changes) throw fail(delta < 0 ? '可用筹码不足' : '余额已达到上限');
  };
  const cashout = (userId, kind = 'cashout') => {
    const seat = stmt('SELECT * FROM arcade_escrow WHERE user_id=?').get(userId);
    if (!seat) return;
    addBalance(userId, seat.amount);
    ledger(userId, kind, seat.amount);
    stmt('DELETE FROM arcade_escrow WHERE user_id=?').run(userId);
  };
  // 牌桌不跨进程恢复。未完成的一手不计输赢，按开局前的托管金额退回，避免重启吞筹码。
  transaction(() => { for (const row of stmt('SELECT user_id FROM arcade_escrow').all()) cashout(row.user_id, 'recovery'); });
  const positiveAmount = amount => {
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_AMOUNT) throw fail('筹码数量须为 1 至 10 亿之间的整数');
    return amount;
  };
  return {
    wallet,
    canMint,
    moveSeat(userId, tableId, requested = 2000, minimum = 20) {
      positiveAmount(requested);
      return transaction(() => {
        ensure(userId); cashout(userId);
        const balance = stmt('SELECT balance FROM arcade_wallets WHERE user_id=?').get(userId).balance;
        const amount = Math.min(balance, requested);
        if (amount < minimum) throw fail(`至少需要 ${minimum.toLocaleString('zh-CN')} 筹码才能入座`);
        addBalance(userId, -amount);
        stmt('INSERT INTO arcade_escrow VALUES (?,?,?)').run(userId, tableId, amount);
        ledger(userId, 'buyin', -amount);
        return amount;
      });
    },
    cashout(userId) { transaction(() => cashout(userId)); },
    topup(userId, tableId, amount = 2000) {
      positiveAmount(amount);
      return transaction(() => {
        const seat = stmt('SELECT * FROM arcade_escrow WHERE user_id=? AND table_id=?').get(userId, tableId);
        if (!seat) throw fail('请先入座', 409);
        if (seat.amount + amount > MAX_AMOUNT) throw fail('牌桌筹码已达到上限');
        addBalance(userId, -amount);
        stmt('UPDATE arcade_escrow SET amount=amount+? WHERE user_id=?').run(amount, userId);
        ledger(userId, 'buyin', -amount);
        return amount;
      });
    },
    settle(table, players, result) {
      transaction(() => {
        if (!stmt('INSERT OR IGNORE INTO arcade_hands VALUES (?,?,?,?)').run(table.handId, table.id, result.totalPot, now()).changes) return;
        for (const player of players) {
          const win = result.winners.find(winner => winner.id === player.id)?.amount || 0;
          const delta = win - player.contribution;
          const escrow = stmt('UPDATE arcade_escrow SET amount=? WHERE user_id=? AND table_id=?').run(player.stack + win, player.id, table.id);
          if (!escrow.changes) throw new Error('Missing arcade escrow at settlement');
          const split = win > 0 && result.pots.some(pot => pot.winnerIds.includes(player.id) && pot.winnerIds.length > 1);
          stmt(`UPDATE arcade_stats SET hands=hands+1,wins=wins+?,splits=splits+?,showdowns=showdowns+?,folds=folds+?,all_ins=all_ins+?,
            vpip=vpip+?,raises=raises+?,wagered=wagered+?,won=won+?,net=net+?,biggest_win=MAX(biggest_win,?),
            best_streak=MAX(best_streak,CASE WHEN ?>0 THEN streak+1 ELSE 0 END),streak=CASE WHEN ?>0 THEN streak+1 ELSE 0 END WHERE user_id=?`)
            .run(Number(win > 0), Number(split), Number(result.reason === 'showdown' && !player.folded), Number(player.folded), Number(player.wasAllIn),
              Number(player.voluntary), Number(player.raised), player.contribution, win, delta, delta, win, win, player.id);
          ledger(player.id, 'hand', delta, { id: `${table.handId}:${player.id}`, note: `第 ${table.handNumber} 局` });
        }
      });
    },
    transfer(actor, { userId, amount, requestId, mint = false, note = '' } = {}) {
      positiveAmount(amount);
      if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(requestId)) throw fail('请求标识无效');
      if (typeof userId !== 'string' || !userById(userId)) throw fail('找不到这个用户', 404);
      if (mint && !canMint(actor)) throw fail('只有总管理员可以发放筹码', 403);
      if (!mint && actor.id === userId) throw fail('不能给自己转账');
      const kind = mint ? 'mint' : 'transfer';
      transaction(() => {
        const prior = stmt('SELECT * FROM arcade_transfers WHERE actor_id=? AND request_id=?').get(actor.id, requestId);
        if (prior) {
          if (prior.kind !== kind || prior.target_id !== userId || prior.amount !== amount) throw fail('重复请求的内容不一致', 409);
          return;
        }
        ensure(actor.id); ensure(userId);
        if (!mint) addBalance(actor.id, -amount);
        addBalance(userId, amount);
        const detail = typeof note === 'string' ? note.trim().slice(0, 80) : '';
        stmt('INSERT INTO arcade_transfers VALUES (?,?,?,?,?,?)').run(actor.id, requestId, kind, userId, amount, now());
        if (!mint) ledger(actor.id, kind, -amount, { peerId: userId, actorId: actor.id, note: detail });
        ledger(userId, kind, amount, { peerId: actor.id, actorId: actor.id, note: detail });
      });
    },
    history(userId) {
      return stmt('SELECT * FROM arcade_ledger WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 50').all(userId)
        .map(row => ({ id: row.id, kind: row.kind, amount: row.amount, peer: row.peer_id ? userById(row.peer_id)?.name || '用户' : '', note: row.note, at: row.created_at }));
    },
    leaderboard(sort = 'net') {
      const keys = new Set(['net', 'total', 'winRate', 'hands', 'won']);
      const field = keys.has(sort) ? sort : 'net';
      const rows = new Map(stmt(`SELECT s.*,w.balance,COALESCE(e.amount,0) AS reserved FROM arcade_stats s JOIN arcade_wallets w ON w.user_id=s.user_id LEFT JOIN arcade_escrow e ON e.user_id=s.user_id`).all().map(row => [row.user_id, row]));
      return listUsers().map(user => {
        const s = rows.get(user.id) || {};
        return { id: user.id, name: user.name, avatar: user.avatar, online: user.online,
          total: (s.balance ?? INITIAL_CHIPS) + (s.reserved || 0), hands: s.hands || 0, wins: s.wins || 0, splits: s.splits || 0,
          winRate: s.hands ? Math.round(s.wins / s.hands * 10000) / 100 : 0, net: s.net || 0,
          won: s.won || 0, wagered: s.wagered || 0, biggestWin: s.biggest_win || 0, showdowns: s.showdowns || 0,
          folds: s.folds || 0, allIns: s.all_ins || 0, vpip: s.hands ? Math.round(s.vpip / s.hands * 100) : 0,
          raises: s.raises || 0, streak: s.streak || 0, bestStreak: s.best_streak || 0 };
      }).sort((a, b) => b[field] - a[field] || b.hands - a.hands || a.id.localeCompare(b.id))
        .map((row, i) => ({ ...row, rank: i + 1 }));
    },
  };
}
