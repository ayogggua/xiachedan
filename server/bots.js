import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { isPresetAvatar } from '../shared/avatars.js';
import { checkCallbackUrl } from './address.js';
import { createBotSender, signPayload } from './botDelivery.js';
import { createHostResolver } from './resolve.js';

// 机器人账号：一个独立成员（名字、头像、简介和普通成员一样存在 users / user_profiles 里），由空间管理者创建。
// 收消息：服务器把事件 POST 到它的回调地址（签名、异步、按机器人排队、限时重试，连续失败后自动停用）；
// 发消息：外部程序带令牌调用 /api/bot/v1/messages。群聊和大厅里默认只收 @它的消息，私聊里收全部；可以打开「接收全部消息」。
// 机器人收不到：阅后即焚、拍一拍、系统提示、机器人（含群机器人 Webhook）发的消息、加入之前的消息、不在的会话里的消息。
const hash = value => createHash('sha256').update(value).digest('hex');
const BOT_LIMIT = 50;
const ROOM_BOT_LIMIT = 10;
const QUEUE_LIMIT = 200;
const SEND_PER_MINUTE = 60;
// 机器人的名字和简介不能带换行、控制字符和改变文字方向的字符（会出现在别人的会话、通知和事件里）。
// 另外挡掉不显示的方向标记（U+200E、U+200F、U+061C）和行、段分隔符（U+2028、U+2029）；其余格式字符（如表情里的 ZWJ）照常可用。
const CONTROL = /[\p{Cc}\u200e\u200f\u061c\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;
const TOKEN = /^Bearer ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([0-9a-f]{48})$/;

export function createBots({ db, stmt, mode, fail, textValue, rateLimit, broadcast, serializeMessage, userById, canAccess, requireRoom, groupSettings,
  isManager, clearedThroughSeq, recalledAt, isBurn, refreshUsers, options = {} }) {
  const retryDelays = options.retryDelays || [2000, 10000, 30000];
  const maxFailures = options.maxFailures || 5;
  const now = options.now || Date.now;
  // dnsServers 只给测试用（指向本机的假 DNS）；lookup 替换局域网模式的 getaddrinfo，也只给测试用。
  const resolver = createHostResolver({ servers: options.dnsServers, ...(options.lookup ? { lookup: options.lookup } : {}), ...(options.maxLookups ? { maxLookups: options.maxLookups } : {}) });
  const sender = createBotSender({ mode, resolver, connect: options.connect, timeoutMs: options.timeoutMs || 5000, tlsOptions: options.tls, ...(options.log ? { log: options.log } : {}) });
  let closed = false;
  const timers = new Set();
  const sleep = ms => new Promise(resolve => { if (closed) return resolve(); const timer = setTimeout(() => { timers.delete(timer); resolve(); }, ms); timers.add(timer); timer.resolve = resolve; });

  const botRow = id => typeof id === 'string' && id.length <= 100 ? stmt('SELECT b.*, u.name, u.avatar FROM bots b JOIN users u ON u.id=b.id WHERE b.id=?').get(id) : null;
  const isBot = id => Boolean(typeof id === 'string' && stmt('SELECT 1 FROM bots WHERE id=?').get(id));
  const usable = bot => Boolean(bot && !bot.deleted_at && bot.status === 'enabled');
  const memberIds = room => JSON.parse(room.members);
  const roomBotIds = roomId => stmt('SELECT r.bot_id FROM bot_rooms r JOIN bots b ON b.id=r.bot_id WHERE r.room_id=? AND b.deleted_at IS NULL ORDER BY r.added_at').all(roomId).map(row => row.bot_id);
  // 私聊里机器人就是成员之一；群聊和大厅里另记在 bot_rooms，after_seq 之前的消息它看不到。
  const membership = (botId, room) => room.kind === 'direct' ? memberIds(room).includes(botId) ? { after_seq: 0 } : null
    : stmt('SELECT * FROM bot_rooms WHERE bot_id=? AND room_id=?').get(botId, room.id) || null;
  const directPeer = (room, botId) => memberIds(room).find(id => id !== botId);
  const audit = (actorId, targetId, action, detail = '') => stmt('INSERT INTO account_audit (actor_id,user_id,action,detail,created_at) VALUES (?,?,?,?,?)').run(actorId, targetId, action, detail, now());
  const transaction = fn => { db.exec('BEGIN'); try { const value = fn(); db.exec('COMMIT'); return value; } catch (error) { db.exec('ROLLBACK'); throw error; } };
  const issueCredentials = id => {
    const token = `${id}.${randomBytes(24).toString('hex')}`, secret = randomBytes(32).toString('hex');
    stmt('UPDATE bots SET token_hash=?, secret=? WHERE id=?').run(hash(token), secret, id);
    return { token, secret };
  };

  // 成员列表里的机器人：在线状态、禁言、部门都没有；删除的标成 removed，以前的消息仍能显示名字和头像。
  const userViews = () => stmt(`SELECT u.id, u.name, u.avatar, b.status, b.receive_all, b.deleted_at, p.bio, c.color FROM bots b JOIN users u ON u.id=b.id
    LEFT JOIN user_profiles p ON p.user_id=b.id LEFT JOIN user_name_colors c ON c.user_id=b.id ORDER BY b.created_at`).all()
    .map(row => ({ id: row.id, name: row.name, avatar: row.avatar, removed: Boolean(row.deleted_at), online: false, status: null, department: '', bio: row.bio || '',
      lastSeen: null, nameColor: row.color ?? null, muted: false, bot: { status: row.deleted_at ? 'deleted' : row.status, receiveAll: Boolean(row.receive_all) } }));
  const managedView = row => ({ id: row.id, name: row.name, avatar: row.avatar, bio: stmt('SELECT bio FROM user_profiles WHERE user_id=?').get(row.id)?.bio || '',
    callbackUrl: row.callback_url, receiveAll: Boolean(row.receive_all), status: row.status, failures: row.failures, lastError: row.last_error || null, lastErrorAt: row.last_error_at || null,
    lastDeliveredAt: row.last_delivered_at || null, createdAt: row.created_at, createdBy: row.created_by,
    rooms: stmt('SELECT r.id, r.name, r.kind FROM bot_rooms b JOIN rooms r ON r.id=b.room_id WHERE b.bot_id=? ORDER BY b.added_at').all(row.id) });

  // 会话里的系统提示：没有发送人（sender_id 为 system），正文在生成时写好，会话列表、搜索、导出直接用。
  const postNotice = (room, kind, botId, text) => {
    const id = randomUUID();
    transaction(() => {
      stmt('INSERT INTO messages (id,room_id,sender_id,text,attachments,client_id,created_at) VALUES (?,?,?,?,?,?,?)').run(id, room.id, 'system', text, '[]', `notice:${id}`, now());
      stmt('INSERT INTO message_notices VALUES (?,?,?)').run(id, kind, botId);
    });
    broadcast({ type: 'message', message: { ...serializeMessage(stmt('SELECT * FROM messages WHERE id=?').get(id)), readBy: [] } }, room.id);
  };
  const placeName = room => room.kind === 'public' ? '大厅' : '群聊';

  // ---------- 投递 ----------
  const queues = new Map();
  const personView = id => ({ id, name: stmt('SELECT name FROM users WHERE id=?').get(id)?.name || '', bot: isBot(id) });
  const roomView = room => ({ id: room.id, kind: room.kind, name: room.kind === 'direct' ? '' : room.name });
  const replyView = (row, seen) => {
    const replyTo = stmt('SELECT reply_to FROM message_replies WHERE message_id=?').get(row.id)?.reply_to;
    if (!replyTo) return null;
    const target = stmt('SELECT * FROM messages WHERE id=?').get(replyTo);
    if (!target || target.seq <= clearedThroughSeq()) return { id: replyTo, missing: true };
    if (recalledAt(target.id)) return { id: target.id, recalled: true };
    // 机器人加入之前的、阅后即焚的原消息只给标识，不给内容。
    if (target.seq <= seen.after_seq || isBurn(target.id)) return { id: target.id, unavailable: true };
    const quote = stmt('SELECT quote FROM message_reply_quotes WHERE message_id=?').get(row.id)?.quote;
    return { id: target.id, sender: personView(target.sender_id), text: target.text, ...(quote ? { quote } : {}) };
  };
  const messageView = (row, bot, seen) => {
    const message = serializeMessage(row);
    const kind = message.poll ? 'poll' : message.chain ? 'chain' : message.card ? 'card' : message.bundle ? 'bundle' : 'text';
    return { id: message.id, seq: message.seq, createdAt: message.createdAt, kind, text: message.text, sender: personView(message.senderId),
      mentions: message.mentions, mentioned: message.mentions.includes(bot.id), threadOf: message.threadOf || null, forwarded: Boolean(message.forwardedFrom), editedAt: message.editedAt,
      replyTo: replyView(row, seen),
      attachments: message.attachments.map(file => ({ name: file.name, mime: file.mime, size: file.size, ...(file.spoiler ? { spoiler: true } : {}) })),
      ...(kind === 'poll' ? { poll: { multiple: message.poll.multiple, options: message.poll.options.map(option => option.text) } } : {}),
      ...(kind === 'card' ? { card: { userId: message.card.userId } } : {}) };
  };
  // 发送前按现在的状态重新取：已经撤回、被删、机器人已被移出的不再发；返回 null 表示跳过。
  const current = (bot, messageId) => {
    const row = stmt('SELECT * FROM messages WHERE id=?').get(messageId);
    const room = row && stmt('SELECT * FROM rooms WHERE id=?').get(row.room_id);
    const seen = room && membership(bot.id, room);
    // 移出后再拉回来：after_seq 是这次加入的位置，之前的消息（哪怕上次收到过）的编辑、撤回也不再发。
    if (!row || !seen || row.seq <= seen.after_seq || row.seq <= clearedThroughSeq() || isBurn(row.id)) return null;
    return { row, room, seen };
  };
  const delivered = (botId, messageId) => Boolean(stmt('SELECT delivered_at FROM bot_deliveries WHERE message_id=? AND bot_id=?').get(messageId, botId)?.delivered_at);
  // 事件标识和时间在排队时定下，重试时不变（接收方可以按标识去重）；每次发送前按最新状态重新组装内容。
  const envelope = (type, bot, job, rest) => ({ id: job.id, type, createdAt: job.createdAt, bot: { id: bot.id }, ...rest });
  const jobs = {
    'message.created': (bot, job) => { const found = current(bot, job.messageId); return found && !recalledAt(job.messageId) && envelope('message.created', bot, job, { room: roomView(found.room), message: messageView(found.row, bot, found.seen) }); },
    'message.edited': (bot, job) => { const found = current(bot, job.messageId); return found && !recalledAt(job.messageId) && delivered(bot.id, job.messageId) && envelope('message.edited', bot, job, { room: roomView(found.room), message: messageView(found.row, bot, found.seen) }); },
    'message.recalled': (bot, job) => { const found = current(bot, job.messageId); return found && delivered(bot.id, job.messageId) && envelope('message.recalled', bot, job, { room: roomView(found.room), message: { id: found.row.id, seq: found.row.seq } }); },
  };
  const headersFor = (bot, event, body) => {
    const timestamp = String(Math.floor(now() / 1000));
    return { 'X-Xiachedan-Event': event.type, 'X-Xiachedan-Delivery': event.id, 'X-Xiachedan-Timestamp': timestamp, 'X-Xiachedan-Signature': `v1=${signPayload(bot.secret, timestamp, body)}` };
  };
  const recordFailure = (botId, error, count) => {
    const failures = count ? (stmt('SELECT failures FROM bots WHERE id=?').get(botId)?.failures || 0) + 1 : null;
    if (count) stmt('UPDATE bots SET failures=?, last_error=?, last_error_at=? WHERE id=?').run(failures, error, now(), botId);
    else stmt('UPDATE bots SET last_error=?, last_error_at=? WHERE id=?').run(error, now(), botId);
    if (count && failures >= maxFailures && stmt("UPDATE bots SET status='failed' WHERE id=? AND status='enabled'").run(botId).changes) {
      stmt('UPDATE bots SET last_error=? WHERE id=?').run(`连续 ${failures} 次投递失败，已自动停用。最后一次：${error}`, botId);
      queues.get(botId)?.items.splice(0);
      audit(botId, botId, 'bot-auto-disable', error);
      refreshUsers();
    }
  };
  // 一个事件：失败且值得重试时按退避间隔再试；每次重试前重新读机器人（可能已停用或换了地址），并重新签名（时间戳是当次的）。
  async function attempt(botId, job) {
    for (let tries = 0; ; tries++) {
      if (closed) return;
      const bot = botRow(botId);
      if (!usable(bot) || !bot.callback_url) return;
      const event = jobs[job.type](bot, job);
      if (!event) return;
      const body = JSON.stringify(event);
      const result = await sender.send(bot.callback_url, body, headersFor(bot, event, body));
      if (closed) return;
      if (result.ok) {
        stmt('UPDATE bots SET failures=0, last_delivered_at=? WHERE id=?').run(now(), botId);
        if (job.type === 'message.created') stmt('UPDATE bot_deliveries SET delivered_at=? WHERE message_id=? AND bot_id=?').run(now(), job.messageId, botId);
        return;
      }
      // 局域网模式下因为别的域名解析占着名额、排队到截止时间也没轮到：不是这个机器人的问题，重试，但不算进连续失败、不会因此自动停用。
      if (!result.retry || tries >= retryDelays.length) return recordFailure(botId, result.error, result.kind !== 'queued');
      await sleep(retryDelays[tries]);
    }
  }
  async function drain(botId, queue) {
    queue.running = true;
    try { while (queue.items.length && !closed) await attempt(botId, queue.items.shift()).catch(error => { if (!closed) recordFailure(botId, `投递出错（${error.message}）`, true); }); }
    finally { queue.running = false; if (!queue.items.length) queues.delete(botId); }
  }
  const enqueue = (botId, job) => {
    if (closed) return;
    const queue = queues.get(botId) || queues.set(botId, { items: [], running: false }).get(botId);
    if (queue.items.length >= QUEUE_LIMIT) return recordFailure(botId, `待投递的事件超过 ${QUEUE_LIMIT} 个，新的事件已丢弃`, false);
    queue.items.push({ ...job, id: randomUUID(), createdAt: now() });
    if (!queue.running) drain(botId, queue);
  };
  // 新消息：只看真人发的（不含机器人、群机器人和系统提示），阅后即焚、拍一拍不发。
  const onMessage = (message, room) => {
    if (!message || message.burn || isBurn(message.id) || message.nudge || message.notice || message.recalledAt) return;
    if (!stmt('SELECT 1 FROM users WHERE id=? AND id NOT IN (SELECT id FROM bots)').get(message.senderId)) return;
    const candidates = room.kind === 'direct'
      ? memberIds(room).map(botRow).filter(Boolean)
      : stmt('SELECT b.*, u.name, u.avatar FROM bot_rooms r JOIN bots b ON b.id=r.bot_id JOIN users u ON u.id=b.id WHERE r.room_id=? AND r.after_seq<?').all(room.id, message.seq)
        .filter(bot => bot.receive_all || message.mentions?.includes(bot.id));
    for (const bot of candidates) {
      if (!usable(bot) || !bot.callback_url) continue;
      stmt('INSERT OR IGNORE INTO bot_deliveries (message_id,bot_id,delivered_at) VALUES (?,?,NULL)').run(message.id, bot.id);
      enqueue(bot.id, { type: 'message.created', messageId: message.id });
    }
  };
  // 撤回、编辑：只通知收到过原消息的机器人（是否真的送达在发送时再查，见 jobs）。
  const followUp = (type, messageId) => { for (const { bot_id: botId } of stmt('SELECT bot_id FROM bot_deliveries WHERE message_id=?').all(messageId)) enqueue(botId, { type, messageId }); };
  const onEvent = (event, room) => {
    if (closed || !room) return;
    if (event.type === 'message') onMessage(event.message, room);
    else if (event.type === 'message-recalled' && event.message) followUp('message.recalled', event.message.id);
    else if (event.type === 'message-edited' && event.message) followUp('message.edited', event.message.id);
  };

  // ---------- 机器人调用的接口（凭令牌，不用登录） ----------
  const botFromRequest = req => {
    const match = TOKEN.exec(req.get('authorization') || '');
    const row = match && botRow(match[1]);
    const given = Buffer.from(hash(match ? `${match[1]}.${match[2]}` : '-')), expected = Buffer.from(row?.token_hash || '');
    if (!row || row.deleted_at || given.length !== expected.length || !timingSafeEqual(given, expected)) throw fail('机器人令牌无效', 401);
    if (row.status !== 'enabled') throw fail('机器人已停用', 403);
    return row;
  };
  const roomsOf = botId => [
    ...stmt('SELECT r.* FROM bot_rooms b JOIN rooms r ON r.id=b.room_id WHERE b.bot_id=? ORDER BY b.added_at').all(botId),
    ...stmt("SELECT * FROM rooms WHERE kind='direct' AND members LIKE ?").all(`%${JSON.stringify(botId)}%`).filter(room => memberIds(room).includes(botId)),
  ];
  // 每个机器人每分钟最多 60 条，按滑动窗口算（记下最近一分钟里每条的时间），不会在两个整分钟交界处连发 120 条。
  const recentSends = new Map();
  const allowSend = botId => {
    const time = now(), recent = (recentSends.get(botId) || []).filter(at => at > time - 60000);
    recentSends.set(botId, recent);
    if (recent.length >= SEND_PER_MINUTE) throw fail(`机器人发得太快了，每分钟最多 ${SEND_PER_MINUTE} 条`, 429);
    recent.push(time);
  };
  function registerApi(app) {
    app.use('/api/bot/', (req, _res, next) => { try { rateLimit(req, 'bot-api', 600); next(); } catch (error) { next(error); } });
    app.get('/api/bot/v1/me', (req, res) => {
      const bot = botFromRequest(req);
      res.json({ bot: { id: bot.id, name: bot.name, receiveAll: Boolean(bot.receive_all) },
        rooms: roomsOf(bot.id).map(room => ({ ...roomView(room), ...(room.kind === 'direct' ? { user: personView(directPeer(room, bot.id)) } : {}) })) });
    });
    // 发一条文字消息：正文与成员发消息的限制相同；可以引用会话里它看得到的消息、@会话里的成员。
    app.post('/api/bot/v1/messages', (req, res) => {
      const bot = botFromRequest(req);
      allowSend(bot.id);
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      if (body.attachmentIds !== undefined || body.attachments !== undefined) throw fail('机器人暂时只能发文字消息');
      if (body.threadOf !== undefined && body.threadOf !== null) throw fail('机器人暂时不能在话题里回复');
      const room = typeof body.roomId === 'string' && body.roomId.length <= 100 && stmt('SELECT * FROM rooms WHERE id=?').get(body.roomId);
      const seen = room && membership(bot.id, room);
      if (!seen) throw fail('机器人不在这个会话里', 403);
      if (room.kind === 'direct' && !canAccess(room, directPeer(room, bot.id))) throw fail('对方已不在这个空间里', 403);
      if (room.kind === 'group' && groupSettings(room).allMuted) throw fail('全员禁言中，只有群主和管理员可以发言', 403);
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      if (!text) throw fail('消息内容不能为空');
      if (text.length > 10000) throw fail('每条消息最多 10000 个字符');
      const clientId = body.clientId === undefined ? '' : textValue(body.clientId, 81);
      if (body.clientId !== undefined && (!clientId || clientId.length > 80)) throw fail('clientId 需要 1–80 个字符');
      if (clientId) {
        const existing = stmt('SELECT * FROM messages WHERE sender_id=? AND client_id=?').get(bot.id, clientId);
        if (existing) return res.json({ message: { id: existing.id, seq: existing.seq, roomId: existing.room_id, createdAt: existing.created_at } });
      }
      let replyTo = null;
      if (body.replyTo !== undefined && body.replyTo !== null) {
        const target = typeof body.replyTo === 'string' && body.replyTo.length <= 100 && stmt('SELECT * FROM messages WHERE id=?').get(body.replyTo);
        if (!target || target.room_id !== room.id || target.seq <= clearedThroughSeq() || target.seq <= seen.after_seq || recalledAt(target.id) || isBurn(target.id)
          || stmt('SELECT 1 FROM message_notices WHERE message_id=?').get(target.id) || stmt('SELECT 1 FROM message_nudges WHERE message_id=?').get(target.id)) throw fail('引用的消息不可用');
        replyTo = target.id;
      }
      const input = body.mentions === undefined ? [] : body.mentions;
      if (!Array.isArray(input) || input.length > 50 || input.some(value => typeof value !== 'string')) throw fail('提及的成员无效');
      const mentions = [...new Set(input)];
      for (const target of mentions) {
        if (target === '*') throw fail('机器人不能 @所有人', 403);
        const human = target !== bot.id && userById(target);
        const inRoom = human ? canAccess(room, target) : membership(target, room) && !botRow(target)?.deleted_at;
        const name = human?.name || (inRoom && botRow(target)?.name);
        if (target === bot.id || !inRoom || !name || !text.includes(`@${name}`)) throw fail('提及的成员无效');
      }
      const id = randomUUID();
      transaction(() => {
        stmt('INSERT INTO messages (id,room_id,sender_id,text,attachments,client_id,created_at) VALUES (?,?,?,?,?,?,?)').run(id, room.id, bot.id, text, '[]', clientId || `bot:${id}`, now());
        if (replyTo) stmt('INSERT INTO message_replies VALUES (?,?)').run(id, replyTo);
        for (const target of mentions) stmt('INSERT INTO message_mentions VALUES (?,?)').run(id, target);
      });
      const row = stmt('SELECT * FROM messages WHERE id=?').get(id);
      broadcast({ type: 'message', message: { ...serializeMessage(row), readBy: [] } }, room.id);
      res.status(201).json({ message: { id, seq: row.seq, roomId: room.id, createdAt: row.created_at } });
    });
  }

  // ---------- 管理（空间管理者）与拉进群（群主、群管理员；大厅是空间管理者） ----------
  const requireManager = req => { if (!isManager(req.user)) throw fail('只有管理员可以管理机器人', 403); };
  const managedBot = id => { const bot = botRow(id); if (!bot || bot.deleted_at) throw fail('机器人不存在', 404); return bot; };
  const profileInput = (body, partial) => {
    const change = {};
    if ([body.name, body.bio].some(value => typeof value === 'string' && CONTROL.test(value))) throw fail('名字和简介里不能有换行或控制字符');
    if (!partial || body.name !== undefined) { change.name = textValue(body.name, 24); if (!change.name) throw fail('给机器人起个名字'); }
    if (!partial || body.avatar !== undefined) {
      if (body.avatar !== undefined && body.avatar !== 'bot' && !isPresetAvatar(body.avatar)) throw fail('请选择有效的头像');
      change.avatar = body.avatar || 'bot';
    }
    if (!partial || body.bio !== undefined) { if (body.bio !== undefined && typeof body.bio !== 'string') throw fail('简介无效'); change.bio = textValue(body.bio, 121); if (change.bio.length > 120) throw fail('简介最多 120 个字'); }
    if (!partial || body.callbackUrl !== undefined) {
      if (body.callbackUrl !== undefined && body.callbackUrl !== '' && typeof body.callbackUrl !== 'string') throw fail('回调地址无效');
      const raw = typeof body.callbackUrl === 'string' ? body.callbackUrl.trim() : '';
      if (raw) { try { change.callbackUrl = checkCallbackUrl(raw, mode).url.href; } catch (error) { throw fail(error.message); } } else change.callbackUrl = '';
    }
    if (!partial || body.receiveAll !== undefined) { if (body.receiveAll !== undefined && typeof body.receiveAll !== 'boolean') throw fail('接收全部消息的设置无效'); change.receiveAll = body.receiveAll === true; }
    return change;
  };
  const saveBio = (id, bio) => stmt('INSERT INTO user_profiles (user_id,department,bio,last_seen) VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET bio=excluded.bio').run(id, '', bio, null);
  // 「接收全部消息」变了：机器人所在的每个群聊和大厅都留一行提示，成员知道说的话会不会发给它。
  const announceReceiveAll = (bot, on) => {
    for (const room of stmt('SELECT r.* FROM bot_rooms b JOIN rooms r ON r.id=b.room_id WHERE b.bot_id=?').all(bot.id))
      postNotice(room, on ? 'receive-all-on' : 'receive-all-off', bot.id, on ? `机器人「${bot.name}」开启了接收全部消息：这里的所有消息都会发给它` : `机器人「${bot.name}」关闭了接收全部消息，之后只接收 @它的消息`);
  };
  const roomsChanged = botId => { for (const { room_id: roomId } of stmt('SELECT room_id FROM bot_rooms WHERE bot_id=?').all(botId)) broadcast({ type: 'rooms' }, roomId); };

  function registerManagement(app) {
    app.get('/api/bots', (req, res) => {
      requireManager(req);
      res.json({ bots: stmt('SELECT b.*, u.name, u.avatar FROM bots b JOIN users u ON u.id=b.id WHERE b.deleted_at IS NULL ORDER BY b.created_at').all().map(managedView) });
    });
    app.post('/api/bots', (req, res) => {
      requireManager(req);
      rateLimit(req, 'bots', 30);
      const input = profileInput(req.body || {}, false);
      if (stmt('SELECT COUNT(*) AS n FROM bots WHERE deleted_at IS NULL').get().n >= BOT_LIMIT) throw fail(`每个空间最多 ${BOT_LIMIT} 个机器人`);
      const id = randomUUID();
      const credentials = transaction(() => {
        stmt('INSERT INTO users (id,name,avatar,token_hash,created_at) VALUES (?,?,?,?,?)').run(id, input.name, input.avatar, hash(randomBytes(32)), now());
        stmt('INSERT INTO bots (id,token_hash,secret,callback_url,receive_all,created_by,created_at) VALUES (?,?,?,?,?,?,?)').run(id, '', '', input.callbackUrl, input.receiveAll ? 1 : 0, req.user.id, now());
        saveBio(id, input.bio);
        audit(req.user.id, id, 'bot-create', input.name);
        return issueCredentials(id);
      });
      refreshUsers();
      res.status(201).json({ bot: managedView(botRow(id)), ...credentials });
    });
    app.post('/api/bots/update', (req, res) => {
      requireManager(req);
      rateLimit(req, 'bots', 30);
      const bot = managedBot(req.body?.id);
      const change = profileInput(req.body || {}, true);
      transaction(() => {
        if (change.name !== undefined || change.avatar !== undefined) stmt('UPDATE users SET name=?, avatar=? WHERE id=?').run(change.name ?? bot.name, change.avatar ?? bot.avatar, bot.id);
        if (change.bio !== undefined) saveBio(bot.id, change.bio);
        if (change.callbackUrl !== undefined) stmt('UPDATE bots SET callback_url=? WHERE id=?').run(change.callbackUrl, bot.id);
        if (change.receiveAll !== undefined) stmt('UPDATE bots SET receive_all=? WHERE id=?').run(change.receiveAll ? 1 : 0, bot.id);
        audit(req.user.id, bot.id, 'bot-update', Object.keys(change).join(','));
        if (change.receiveAll !== undefined && change.receiveAll !== Boolean(bot.receive_all)) audit(req.user.id, bot.id, 'bot-receive-all', change.receiveAll ? '开启' : '关闭');
      });
      if (change.receiveAll !== undefined && change.receiveAll !== Boolean(bot.receive_all)) announceReceiveAll(botRow(bot.id), change.receiveAll);
      refreshUsers();
      roomsChanged(bot.id);
      res.json({ bot: managedView(botRow(bot.id)) });
    });
    // 停用：不再收发消息，排队的事件丢掉；重新启用后失败计数清零。
    app.post('/api/bots/status', (req, res) => {
      requireManager(req);
      rateLimit(req, 'bots', 30);
      const bot = managedBot(req.body?.id);
      if (typeof req.body.enabled !== 'boolean') throw fail('请选择启用或停用');
      stmt('UPDATE bots SET status=?, failures=0 WHERE id=?').run(req.body.enabled ? 'enabled' : 'disabled', bot.id);
      if (!req.body.enabled) queues.get(bot.id)?.items.splice(0);
      audit(req.user.id, bot.id, req.body.enabled ? 'bot-enable' : 'bot-disable');
      refreshUsers();
      res.json({ bot: managedView(botRow(bot.id)) });
    });
    // 重置令牌和签名密钥：旧令牌立即失效，新的只在这里返回一次。
    app.post('/api/bots/reset', (req, res) => {
      requireManager(req);
      rateLimit(req, 'bots', 30);
      const bot = managedBot(req.body?.id);
      const credentials = issueCredentials(bot.id);
      audit(req.user.id, bot.id, 'bot-reset');
      res.json(credentials);
    });
    // 发送测试事件：只发一次、不重试、不进队列，也不计入连续失败；停用的机器人也可以测，方便修好地址后再启用。
    app.post('/api/bots/test', async (req, res) => {
      requireManager(req);
      rateLimit(req, 'bot-test', 10);
      const bot = managedBot(req.body?.id);
      if (!bot.callback_url) throw fail('先填写回调地址');
      const event = { id: randomUUID(), type: 'bot.test', createdAt: now(), bot: { id: bot.id, name: bot.name } };
      const body = JSON.stringify(event);
      const result = await sender.send(bot.callback_url, body, headersFor(bot, event, body));
      if (result.ok) stmt('UPDATE bots SET last_delivered_at=? WHERE id=?').run(now(), bot.id);
      else stmt('UPDATE bots SET last_error=?, last_error_at=? WHERE id=?').run(`测试事件：${result.error}`, now(), bot.id);
      res.json({ ok: result.ok, status: result.status || null, error: result.error || null, bot: managedView(botRow(bot.id)) });
    });
    // 删除：令牌失效、退出所有群聊和大厅；以前发的消息保留，显示为已删除的机器人；和它的私聊留着记录但不能再发。
    app.post('/api/bots/delete', (req, res) => {
      requireManager(req);
      const bot = managedBot(req.body?.id);
      const rooms = stmt('SELECT r.* FROM bot_rooms b JOIN rooms r ON r.id=b.room_id WHERE b.bot_id=?').all(bot.id);
      transaction(() => {
        stmt("UPDATE bots SET deleted_at=?, status='disabled', token_hash='', secret='', callback_url='' WHERE id=?").run(now(), bot.id);
        stmt('DELETE FROM bot_rooms WHERE bot_id=?').run(bot.id);
        audit(req.user.id, bot.id, 'bot-delete', bot.name);
      });
      queues.get(bot.id)?.items.splice(0);
      refreshUsers();
      // 和移出一样，在它待过的每个群聊和大厅留一行提示（开着「接收全部消息」时尤其要让成员知道它不再收了）。
      for (const room of rooms) {
        broadcast({ type: 'rooms' }, room.id);
        postNotice(room, 'bot-deleted', bot.id, `${req.user.name}删除了机器人「${bot.name}」，它已退出${placeName(room)}`);
      }
      res.json({ ok: true });
    });
    app.post('/api/room-bots', (req, res) => {
      rateLimit(req, 'room-bots', 30);
      const room = requireRoom(req.body?.roomId, req.user.id);
      if (room.kind === 'direct') throw fail('私聊里不能添加机器人');
      const allowed = room.kind === 'group' ? (({ ownerId, adminIds }) => ownerId === req.user.id || adminIds.includes(req.user.id))(groupSettings(room)) : isManager(req.user);
      if (!allowed) throw fail(room.kind === 'group' ? '只有群主或管理员可以添加或移出机器人' : '只有管理员可以管理大厅里的机器人', 403);
      const bot = managedBot(req.body?.botId);
      if (typeof req.body.add !== 'boolean') throw fail('请选择添加或移出');
      const actor = req.user.name;
      if (req.body.add) {
        if (membership(bot.id, room)) return res.json({ bots: roomBotIds(room.id) });
        if (!usable(bot)) throw fail('机器人已停用，不能添加');
        if (roomBotIds(room.id).length >= ROOM_BOT_LIMIT) throw fail(`每个会话最多 ${ROOM_BOT_LIMIT} 个机器人`);
        const afterSeq = stmt('SELECT COALESCE(MAX(seq), 0) AS n FROM messages').get().n;
        stmt('INSERT INTO bot_rooms (bot_id,room_id,added_by,added_at,after_seq) VALUES (?,?,?,?,?)').run(bot.id, room.id, req.user.id, now(), afterSeq);
        broadcast({ type: 'rooms' }, room.id);
        postNotice(room, 'bot-added', bot.id, `${actor}把机器人「${bot.name}」加入了${placeName(room)}${bot.receive_all ? '。它会接收这里的全部消息' : '，@它的消息会发给它'}`);
      } else {
        if (!stmt('DELETE FROM bot_rooms WHERE bot_id=? AND room_id=?').run(bot.id, room.id).changes) throw fail('机器人不在这个会话里', 404);
        broadcast({ type: 'rooms' }, room.id);
        postNotice(room, 'bot-removed', bot.id, `${actor}把机器人「${bot.name}」移出了${placeName(room)}`);
      }
      res.json({ bots: roomBotIds(room.id) });
    });
  }

  return {
    registerApi, registerManagement, onEvent, userViews, roomBotIds, botRow, isBot, membership,
    // 和机器人的私聊：只有启用的机器人能新开；已删除的不能再发消息。
    directBot: room => room.kind === 'direct' ? memberIds(room).map(botRow).find(Boolean) || null : null,
    close: () => { closed = true; for (const timer of timers) { clearTimeout(timer); timer.resolve(); } timers.clear(); queues.clear(); sender.close(); },
  };
}
