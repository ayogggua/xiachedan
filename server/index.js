import express from 'express';
import multer from 'multer';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'node:http';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { mkdirSync, unlinkSync, openSync, readSync, closeSync, statSync, realpathSync, linkSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore, serializeMessage as baseMessage } from './store.js';
import { lanAddresses } from './network.js';
import { createAuth } from './auth.js';
import { fetchPreview } from './linkPreview.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_FILE = 100 * 1024 * 1024;
// 表情回应的固定选项，随会话状态下发给客户端。
const REACTIONS = ['👍', '❤️', '😂', '🎉', '😮', '🙏', '✅', '👀'];
const PRESETS = ['cat', 'bird', 'rabbit', 'fish', 'coffee', 'mountain', 'planet', 'sprout'];
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const textValue = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const sizeText = bytes => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const loopback = address => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);

function detectMime(file) {
  const fd = openSync(file, 'r');
  const bytes = Buffer.alloc(64);
  try { readSync(fd, bytes, 0, 64, 0); } finally { closeSync(fd); }
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) return 'image/gif';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (bytes.toString('ascii', 4, 8) === 'ftyp') {
    const brand = bytes.toString('ascii', 8, 12);
    if (['avif', 'avis', 'heic', 'heix', 'mif1'].includes(brand)) return null;
    return brand === 'qt  ' ? 'video/quicktime' : 'video/mp4';
  }
  if (bytes.subarray(0,4).equals(Buffer.from([26,69,223,163])) && bytes.includes(Buffer.from('webm'))) return 'video/webm';
  return null;
}

export async function startServer({ dataDir = path.join(root, '.data'), port = 4318, host = '0.0.0.0',
  mode = process.env.CHAT_MODE || (process.env.NODE_ENV === 'production' ? 'cloud' : 'local'),
  serveWeb = process.env.CHAT_SERVE_WEB === 'true' || (mode === 'local' && process.env.CHAT_SERVE_WEB !== 'false'),
  previewFetcher = fetchPreview,
  scheduleInterval = 15000,
  scheduleMinLead = 30000,
} = {}) {
  if (!['cloud', 'local'].includes(mode)) throw new Error('CHAT_MODE 必须是 cloud 或 local');
  const cloud = mode === 'cloud';
  const production = process.env.NODE_ENV === 'production';
  if (production && !cloud) throw new Error('生产环境必须启用账号登录模式');
  const allowedOrigins = new Set((process.env.CHAT_ALLOWED_ORIGINS || process.env.CHAT_PUBLIC_URL || '').split(',').map(value => value.trim()).filter(Boolean));
  for (const origin of allowedOrigins) {
    const parsed = new URL(origin);
    if (parsed.origin !== origin || !['https:', 'http:'].includes(parsed.protocol) || (production && parsed.protocol !== 'https:')) throw new Error('CHAT_ALLOWED_ORIGINS 必须是完整的 HTTPS 来源，不含路径');
  }
  if (cloud && production && (!process.env.CHAT_PUBLIC_URL || !allowedOrigins.has(process.env.CHAT_PUBLIC_URL))) throw new Error('生产环境需要可信的 CHAT_PUBLIC_URL');
  const db = openStore(dataDir);
  const uploadDir = path.join(dataDir, 'uploads');
  mkdirSync(uploadDir, { recursive: true, mode: 0o700 });
  const setupKey = randomBytes(32).toString('hex');
  const app = express();
  if (cloud && process.env.CHAT_TRUST_PROXY) app.set('trust proxy', /^\d+$/.test(process.env.CHAT_TRUST_PROXY) ? Number(process.env.CHAT_TRUST_PROXY) : process.env.CHAT_TRUST_PROXY.split(',').map(value => value.trim()));
  const server = createServer(app);
  const sockets = new Set();
  let closing = false;
  let auth;
  let activeUploads = 0;
  const storageBudget = Number(process.env.CHAT_MAX_STORAGE_BYTES || 10 * 1024 ** 3);
  if (!Number.isSafeInteger(storageBudget) || storageBudget < MAX_FILE) { db.close(); throw new Error('CHAT_MAX_STORAGE_BYTES 必须大于单文件限制'); }
  const failures = new Map();
  const limits = new Map();
  const stmt = sql => db.prepare(sql);
  const recalledAt = id => stmt('SELECT recalled_at FROM message_recalls WHERE message_id=?').get(id)?.recalled_at || null;
  // 引用内容随原消息变化：原消息被撤回或清空后只保留标识。
  const replyFor = id => {
    const row = stmt('SELECT r.reply_to AS replyTo, m.* FROM message_replies r LEFT JOIN messages m ON m.id=r.reply_to WHERE r.message_id=?').get(id);
    if (!row) return null;
    if (!row.id || row.seq <= clearedThroughSeq()) return { id: row.replyTo, missing: true };
    if (recalledAt(row.id)) return { id: row.id, seq: row.seq, senderId: row.sender_id, recalled: true };
    return { id: row.id, seq: row.seq, senderId: row.sender_id, text: row.text.slice(0, 200),
      attachments: JSON.parse(row.attachments).map(file => ({ name: file.name, mime: file.mime })) };
  };
  const mentionsOf = id => stmt('SELECT user_id FROM message_mentions WHERE message_id=? ORDER BY rowid').all(id).map(row => row.user_id);
  // 按表情第一次出现的先后排列，每个表情附上回应的成员。
  const reactionsOf = id => {
    const groups = new Map();
    for (const row of stmt('SELECT emoji, user_id FROM message_reactions WHERE message_id=? ORDER BY created_at, rowid').all(id)) {
      if (!groups.has(row.emoji)) groups.set(row.emoji, []);
      groups.get(row.emoji).push(row.user_id);
    }
    return [...groups].map(([emoji, users]) => ({ emoji, users }));
  };
  const forwardOf = id => {
    const row = stmt('SELECT original_sender, original_created_at FROM message_forwards WHERE message_id=?').get(id);
    return row ? { senderId: row.original_sender, createdAt: row.original_created_at } : null;
  };
  const botOf = id => stmt('SELECT name FROM message_bots WHERE message_id=?').get(id)?.name || null;
  const editedAt = id => stmt('SELECT edited_at FROM message_edits WHERE message_id=?').get(id)?.edited_at || null;
  const removedBy = id => stmt('SELECT actor_id FROM message_removals WHERE message_id=?').get(id)?.actor_id || null;
  const pollOf = id => {
    const poll = stmt('SELECT * FROM polls WHERE message_id=?').get(id);
    if (!poll) return null;
    const votes = stmt('SELECT user_id, option_index FROM poll_votes WHERE message_id=? ORDER BY voted_at, rowid').all(id);
    return { multiple: Boolean(poll.multiple), closedAt: poll.closed_at, options: JSON.parse(poll.options).map((text, index) => ({ text, voters: votes.filter(vote => vote.option_index === index).map(vote => vote.user_id) })) };
  };
  const NOT_THREAD = 'id NOT IN (SELECT message_id FROM message_threads)';
  const threadOf = id => stmt('SELECT root_id FROM message_threads WHERE message_id=?').get(id)?.root_id || null;
  const threadInfo = id => {
    const row = stmt(`SELECT COUNT(*) AS count, MAX(m.created_at) AS lastAt FROM message_threads t JOIN messages m ON m.id=t.message_id
      WHERE t.root_id=? AND m.id NOT IN (SELECT message_id FROM message_recalls)`).get(id);
    if (!row.count) return null;
    const participants = stmt(`SELECT DISTINCT m.sender_id AS id FROM message_threads t JOIN messages m ON m.id=t.message_id WHERE t.root_id=? ORDER BY m.seq DESC LIMIT 3`).all(id).map(item => item.id);
    return { count: row.count, lastAt: row.lastAt, participants };
  };
  const serializeMessage = row => row ? { ...baseMessage(row), threadOf: threadOf(row.id), thread: threadInfo(row.id), poll: pollOf(row.id), bot: botOf(row.id), editedAt: editedAt(row.id), removedBy: removedBy(row.id), recalledAt: recalledAt(row.id), replyTo: replyFor(row.id), mentions: mentionsOf(row.id), reactions: reactionsOf(row.id), forwardedFrom: forwardOf(row.id) } : null;
  const clearedThroughSeq = () => stmt('SELECT cleared_through_seq FROM history_state WHERE id=1').get().cleared_through_seq;
  const cleanFiles = () => {
    for (const { id } of stmt('SELECT id FROM pending_file_deletions').all()) {
      try { unlinkSync(path.join(uploadDir, id)); }
      catch (error) { if (error.code !== 'ENOENT') continue; }
      stmt('DELETE FROM pending_file_deletions WHERE id=?').run(id);
    }
  };
  cleanFiles();
  const fileSize = file => { try { return statSync(file).size; } catch { return 0; } };
  const storage = () => ({
    messageCount: stmt('SELECT COUNT(*) AS n FROM messages').get().n,
    attachmentBytes: stmt("SELECT COALESCE(SUM(size),0) AS n FROM uploads WHERE purpose='message' AND claimed=1").get().n,
    databaseBytes: ['chat.sqlite', 'chat.sqlite-wal'].reduce((sum, file) => sum + fileSize(path.join(dataDir, file)), 0),
    pendingBytes: stmt('SELECT id FROM pending_file_deletions').all().reduce((sum, row) => sum + fileSize(path.join(uploadDir, row.id)), 0),
  });
  const workspace = () => stmt('SELECT * FROM workspace WHERE id=1').get();
  const ownerId = () => stmt('SELECT user_id FROM space_admin WHERE id=1').get()?.user_id;
  const isRemoved = id => Boolean(stmt('SELECT 1 FROM removed_users WHERE user_id=?').get(id));
  const spaceInfo = () => ({ name: workspace().name, ownerId: ownerId(), mode });
  const userById = id => (!cloud || auth.activeId(id)) ? stmt('SELECT id, name, avatar FROM users WHERE id=? AND id NOT IN (SELECT user_id FROM removed_users)').get(id) : null;
  const tokenFrom = req => {
    const cookie = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith('linliao_session='));
    return cookie ? cookie.slice('linliao_session='.length) : '';
  };
  const authUser = req => {
    if (cloud) return auth.user(req);
    const token = tokenFrom(req);
    return token ? stmt('SELECT id, name, avatar FROM users WHERE token_hash=? AND id NOT IN (SELECT user_id FROM removed_users)').get(hash(token)) : null;
  };
  const canAccess = (room, userId) => room && !isRemoved(userId) && (!cloud || auth.activeId(userId)) && (room.kind === 'public' || JSON.parse(room.members).includes(userId));
  const requireRoom = (id, userId) => {
    const room = typeof id === 'string' ? stmt('SELECT * FROM rooms WHERE id=?').get(id) : null;
    if (!canAccess(room, userId)) throw fail('无法访问这个会话', 403);
    return room;
  };
  const withReads = messages => {
    if (!messages.length) return [];
    const ids = messages.map(message => message.id);
    const reads = stmt(`SELECT message_id, user_id FROM message_reads WHERE message_id IN (${ids.map(() => '?').join(',')})`).all(...ids);
    const readers = new Map();
    for (const read of reads) {
      if (!readers.has(read.message_id)) readers.set(read.message_id, []);
      readers.get(read.message_id).push(read.user_id);
    }
    return messages.map(message => ({ ...message, readBy: readers.get(message.id) || [] }));
  };
  const onlineIds = () => new Set([...sockets].filter(s => s.readyState === WebSocket.OPEN).map(s => s.userId));
  const users = () => {
    const online = onlineIds();
    const rows = stmt(cloud ? "SELECT u.id,u.name,u.avatar FROM users u JOIN accounts a ON a.user_id=u.id WHERE a.status IN ('approved','suspended') ORDER BY u.created_at" : 'SELECT id, name, avatar FROM users ORDER BY created_at').all();
    const profiles = new Map(stmt('SELECT * FROM user_profiles').all().map(row => [row.user_id, row]));
    const mutes = new Map(stmt('SELECT user_id, until FROM member_mutes').all().map(row => [row.user_id, row.until]));
    return rows.map(user => { const removed = isRemoved(user.id) || (cloud && !auth.activeId(user.id)); const profile = profiles.get(user.id);
      return { ...user, removed, online: !removed && online.has(user.id), department: profile?.department || '', bio: profile?.bio || '', lastSeen: profile?.last_seen || null, muted: Boolean(mutes.has(user.id) && (mutes.get(user.id) === null || mutes.get(user.id) > Date.now())) }; });
  };
  // 群主：记录的群主不在群里（或旧数据没有记录）时，由成员列表里最早的人接任；创建群聊时创建者排在第一位。
  const groupSettings = room => {
    const members = JSON.parse(room.members);
    const row = stmt('SELECT * FROM room_settings WHERE room_id=?').get(room.id);
    return { ownerId: row?.owner_id && members.includes(row.owner_id) ? row.owner_id : members[0] || null,
      announcement: row?.announcement ? { text: row.announcement, updatedAt: row.announcement_at, updatedBy: row.announcement_by } : null };
  };
  const saveSettings = (roomId, change) => {
    const current = stmt('SELECT * FROM room_settings WHERE room_id=?').get(roomId) || { owner_id: null, announcement: '', announcement_at: null, announcement_by: null };
    const next = { ...current, ...change };
    stmt('INSERT OR REPLACE INTO room_settings (room_id,owner_id,announcement,announcement_at,announcement_by) VALUES (?,?,?,?,?)').run(roomId, next.owner_id, next.announcement, next.announcement_at, next.announcement_by);
  };
  const requireGroupOwner = (roomId, userId) => {
    const room = requireRoom(roomId, userId);
    if (room.kind !== 'group') throw fail('只有群聊可以这样设置');
    if (groupSettings(room).ownerId !== userId) throw fail('只有群主可以这样设置', 403);
    return room;
  };
  const roomsFor = userId => stmt('SELECT * FROM rooms ORDER BY created_at').all()
    .filter(room => canAccess(room, userId)).map(room => ({ id: room.id, name: room.name, kind: room.kind,
      members: JSON.parse(room.members), lastMessage: serializeMessage(stmt(`SELECT * FROM messages WHERE room_id=? AND ${NOT_THREAD} ORDER BY seq DESC LIMIT 1`).get(room.id)),
      ...(room.kind === 'group' ? groupSettings(room) : {}) }));
  // 禁言状态：返回截止时间，一直禁言为 Infinity，没有禁言为 null；过期的记录顺手清掉。
  const muteOf = id => {
    const row = stmt('SELECT until FROM member_mutes WHERE user_id=?').get(id);
    if (!row) return null;
    if (row.until !== null && row.until <= Date.now()) { stmt('DELETE FROM member_mutes WHERE user_id=?').run(id); return null; }
    return row.until ?? Infinity;
  };
  const requireVoice = user => {
    const until = muteOf(user.id);
    if (until) throw fail(until === Infinity ? '你已被管理员禁言' : `你已被管理员禁言，${new Date(until).toLocaleString('zh-CN', { hour12: false })} 后恢复`, 403);
  };
  const retentionDays = () => Number(stmt("SELECT value FROM space_settings WHERE key='retention_days'").get()?.value || 0);
  const stateFor = user => {
    const rooms = roomsFor(user.id);
    const allowed = new Set(rooms.map(room => room.id));
    const recalls = stmt('SELECT m.id, m.room_id AS roomId, r.recalled_at AS recalledAt FROM message_recalls r JOIN messages m ON m.id=r.message_id').all().filter(row => allowed.has(row.roomId));
    return { me: { ...user, ...(until => ({ muted: Boolean(until), mutedUntil: until === Infinity ? null : until }))(muteOf(user.id)) }, workspace: { ...spaceInfo(), retentionDays: retentionDays() }, users: users(), rooms, recalls, clearedThroughSeq: clearedThroughSeq(), reactions: REACTIONS };
  };
  const deliver = (event, accepts) => {
    const payload = JSON.stringify(event);
    for (const socket of sockets) if (socket.readyState === WebSocket.OPEN && !isRemoved(socket.userId) && (!cloud || auth.validSocket(socket)) && accepts(socket)) {
      if (socket.bufferedAmount > 1024 * 1024) socket.terminate(); else socket.send(payload);
    }
  };
  const broadcast = (event, roomId) => {
    const room = roomId ? stmt('SELECT * FROM rooms WHERE id=?').get(roomId) : null;
    deliver(event, socket => !roomId || canAccess(room, socket.userId));
  };
  const setSession = (res, token) => res.cookie('linliao_session', token, { httpOnly: true, sameSite: 'strict', maxAge: 90 * 86400000, path: '/' });
  const userCreated = (req, res, name, avatar) => {
    const token = randomBytes(32).toString('hex');
    const user = { id: randomUUID(), name, avatar: PRESETS.includes(avatar) ? avatar : 'cat' };
    stmt('INSERT INTO users (id,name,avatar,token_hash,created_at) VALUES (?,?,?,?,?)').run(user.id, name, user.avatar, hash(token), Date.now());
    setSession(res, token);
    broadcast({ type: 'users', users: users() });
    return user;
  };
  const rateLimit = (req, key, max, duration = 60000, identity) => {
    const id = `${identity || req.user?.id || req.ip || req.socket.remoteAddress}:${key}`;
    const current = limits.get(id);
    if (!current && limits.size >= 20000) throw fail('服务繁忙，请稍后再试', 429);
    if (!current || current.until < Date.now()) limits.set(id, { count: 1, until: Date.now() + duration });
    else if (++current.count > max) throw fail('操作有些频繁，稍后再试', 429);
  };
  const originOK = req => !req.headers.origin || (cloud ? allowedOrigins.has(req.headers.origin) : req.headers.origin === `http://${req.headers.host}`);
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self' ipc: http://ipc.localhost; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" });
    if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
    if (cloud && req.headers.origin) {
      if (!originOK(req)) return next(fail('请求来源无效', 403));
      res.set({ 'Access-Control-Allow-Origin': req.headers.origin, 'Access-Control-Allow-Credentials': 'true' });
      res.vary('Origin');
    }
    if (cloud && req.method === 'OPTIONS') {
      res.set({ 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-Linliao, X-Setup-Key', 'Access-Control-Max-Age': '600' });
      return res.sendStatus(204);
    }
    // 机器人地址由外部服务器调用，凭令牌鉴权，不带浏览器的来源与自定义请求头。
    const hook = req.path.startsWith('/api/hooks/');
    if (!hook && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && (!originOK(req) || req.get('X-Linliao') !== '1')) return next(fail('请求来源无效', 403));
    next();
  });
  app.use(express.json({ limit: '64kb' }));
  if (cloud) {
    try { auth = await createAuth({ db, app, production, rateLimit,
      closeUser: (id, sessionHash) => { for (const socket of sockets) if (sessionHash ? socket.sessionHash === sessionHash : socket.userId === id) socket.close(4001, 'account-changed'); },
      changed: () => { broadcast({ type: 'users', users: users() }); broadcast({ type: 'rooms' }); },
    }); } catch (error) { db.close(); throw error; }
  }
  app.get('/api/health', (_req, res) => { stmt('SELECT 1').get(); res.json({ app: 'linliao', version: '1.4.1', mode, ok: true, release: process.env.CHAT_RELEASE || 'development' }); });
  app.get('/api/bootstrap', (req, res) => {
    const ws = workspace();
    const me = authUser(req);
    res.json({ configured: Boolean(ws), workspace: ws ? spaceInfo() : null,
      spaceId: ws ? stmt('SELECT space_id FROM space_identity WHERE id=1').get().space_id : null,
      mode, account: cloud ? auth.account(req) : null,
      canCreate: !cloud && loopback(req.socket.remoteAddress) && req.get('X-Setup-Key') === setupKey,
      me, ...(me ? stateFor(me) : {}) });
  });
  // 公网模式完全关闭邀请码、本机初始化和设备旧凭证入口，不能绕过账号审核。
  if (cloud) app.use(['/api/setup', '/api/join', '/api/device', '/api/remove-member', '/api/logout'], (_req, _res, next) => next(fail('请使用账号登录和用户管理', 403)));
  app.post('/api/setup', (req, res) => {
    if (!loopback(req.socket.remoteAddress) || req.get('X-Setup-Key') !== setupKey) throw fail('请在创建空间的 Mac 上操作', 403);
    if (workspace()) throw fail('空间已创建，请直接加入', 409);
    const name = textValue(req.body.name, 24);
    const spaceName = textValue(req.body.spaceName, 32);
    if (!name || !spaceName) throw fail('请输入空间名称和昵称');
    const inviteCode = randomBytes(6).toString('hex').toUpperCase();
    db.exec('BEGIN');
    try {
      stmt('INSERT INTO workspace (id,name,invite_code) VALUES (1,?,?)').run(spaceName, inviteCode);
      stmt('INSERT INTO rooms (id,name,kind,created_at) VALUES (?,?,?,?)').run('lobby', '大厅', 'public', Date.now());
      const me = userCreated(req, res, name, req.body.avatar);
      stmt('INSERT INTO space_admin (id,user_id) VALUES (1,?)').run(me.id);
      db.exec('COMMIT');
      res.status(201).json({ me });
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  });
  app.post('/api/join', (req, res) => {
    const ip = req.socket.remoteAddress;
    const attempt = failures.get(ip);
    if (attempt?.count >= 12 && attempt.until > Date.now()) throw fail('邀请码尝试过多，请 5 分钟后重试', 429);
    const ws = workspace();
    if (!ws) throw fail('这个空间还未创建');
    const code = textValue(req.body.inviteCode, 100).replace(/\s/g, '').toUpperCase();
    const a = Buffer.from(code), b = Buffer.from(ws.invite_code);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      failures.set(ip, { count: attempt?.until > Date.now() ? attempt.count + 1 : 1, until: Date.now() + 300000 });
      throw fail('邀请码不正确，请向空间创建者确认', 403);
    }
    failures.delete(ip);
    const existing = authUser(req);
    if (existing) return res.json({ me: existing });
    const name = textValue(req.body.name, 24);
    if (!name) throw fail('给自己起个昵称吧');
    rateLimit(req, 'join', 10);
    res.status(201).json({ me: userCreated(req, res, name, req.body.avatar) });
  });
  // 桌面端凭本机为这个空间保存的凭证认回身份，不依赖 IP 与 WebView 中的会话 Cookie；legacy 是旧版 Electron 留下的会话，用于一次性迁移。
  app.post('/api/device', (req, res) => {
    rateLimit(req, 'device', 30);
    const device = textValue(req.body?.device, 128);
    if (!/^[0-9a-f]{64}$/.test(device)) throw fail('设备凭证无效');
    const legacy = textValue(req.body?.legacy, 128);
    const current = authUser(req);
    const previous = legacy && stmt('SELECT id, name, avatar FROM users WHERE token_hash=? AND id NOT IN (SELECT user_id FROM removed_users)').get(hash(legacy));
    const bound = stmt('SELECT u.id, u.name, u.avatar FROM user_devices d JOIN users u ON u.id=d.user_id WHERE d.device_hash=? AND u.id NOT IN (SELECT user_id FROM removed_users)').get(hash(device));
    const me = previous || current || bound;
    if (!me) throw fail('这台电脑还没有加入过这个空间', 404);
    stmt('INSERT OR REPLACE INTO user_devices (device_hash,user_id,created_at) VALUES (?,?,?)').run(hash(device), me.id, Date.now());
    if (previous) setSession(res, legacy);
    else if (!current) {
      const token = randomBytes(32).toString('hex');
      stmt('UPDATE users SET token_hash=? WHERE id=?').run(hash(token), me.id);
      setSession(res, token);
    }
    res.json({ me, switched: me.id !== current?.id });
  });
  // 群机器人发消息：POST /api/hooks/:id/:token，正文 { "text": "..." }。
  app.post('/api/hooks/:id/:token', (req, res) => {
    const webhook = stmt('SELECT * FROM webhooks WHERE id=?').get(req.params.id);
    const a = Buffer.from(hash(req.params.token)), b = Buffer.from(webhook?.token_hash || '');
    if (!webhook || a.length !== b.length || !timingSafeEqual(a, b)) throw fail('机器人地址无效', 404);
    rateLimit(req, 'hook', 30, 60000, `webhook:${webhook.id}`);
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text) throw fail('消息内容不能为空');
    if (text.length > 4000) throw fail('机器人消息最多 4000 个字符');
    if (!stmt('SELECT 1 FROM rooms WHERE id=?').get(webhook.room_id)) throw fail('会话已不存在', 404);
    const id = randomUUID();
    db.exec('BEGIN');
    try {
      stmt('INSERT INTO messages (id,room_id,sender_id,text,attachments,client_id,created_at) VALUES (?,?,?,?,?,?,?)').run(id, webhook.room_id, `webhook:${webhook.id}`, text, '[]', `hook:${id}`, Date.now());
      stmt('INSERT INTO message_bots VALUES (?,?)').run(id, webhook.name);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    const message = { ...serializeMessage(stmt('SELECT * FROM messages WHERE id=?').get(id)), readBy: [] };
    broadcast({ type: 'message', message }, webhook.room_id);
    res.status(201).json({ ok: true, id });
  });
  app.use('/api', (req, _res, next) => {
    req.user = authUser(req);
    if (req.user && cloud) touchDevice(req);
    next(req.user ? undefined : fail(cloud ? '请先登录并等待管理员审核通过' : '请先加入空间', 401));
  });
  // 登录设备：每个登录会话一行，最多每分钟更新一次最后活跃时间。
  const touchDevice = req => {
    const tokenHash = auth.tokenHash(req), now = Date.now();
    const row = stmt('SELECT last_seen FROM session_devices WHERE token_hash=?').get(tokenHash);
    if (row && now - row.last_seen < 60000) return;
    const agent = textValue(req.get('User-Agent'), 300), ip = textValue(req.ip || req.socket.remoteAddress, 64);
    if (row) stmt('UPDATE session_devices SET last_seen=?, ip=?, user_agent=? WHERE token_hash=?').run(now, ip, agent, tokenHash);
    else stmt('INSERT INTO session_devices VALUES (?,?,?,?,?)').run(tokenHash, agent, ip, now, now);
  };
  const requireCloud = () => { if (!cloud) throw fail('局域网模式没有登录设备管理', 403); };
  app.get('/api/sessions', (req, res) => {
    requireCloud();
    stmt('DELETE FROM session_devices WHERE token_hash NOT IN (SELECT token_hash FROM sessions)').run();
    const current = auth.tokenHash(req);
    const rows = stmt(`SELECT s.token_hash, s.created_at, s.expires_at, d.user_agent, d.ip, d.last_seen FROM sessions s LEFT JOIN session_devices d ON d.token_hash=s.token_hash
      WHERE s.user_id=? AND s.expires_at>? ORDER BY COALESCE(d.last_seen, s.created_at) DESC`).all(req.user.id, Date.now());
    res.json({ sessions: rows.map(row => ({ id: row.token_hash, current: row.token_hash === current, userAgent: row.user_agent || '', ip: row.ip || '',
      createdAt: row.created_at, lastSeen: row.last_seen || row.created_at, expiresAt: row.expires_at })) });
  });
  // 让某个设备下线，或一次让除当前设备以外的全部下线；对应的实时连接立即断开。
  app.post('/api/sessions/revoke', (req, res) => {
    requireCloud();
    rateLimit(req, 'sessions', 30);
    const current = auth.tokenHash(req);
    const targets = req.body?.others === true
      ? stmt('SELECT token_hash FROM sessions WHERE user_id=? AND token_hash<>?').all(req.user.id, current).map(row => row.token_hash)
      : [req.body?.id].filter(id => typeof id === 'string' && /^[0-9a-f]{64}$/.test(id) && id !== current && stmt('SELECT 1 FROM sessions WHERE token_hash=? AND user_id=?').get(id, req.user.id));
    if (!targets.length && req.body?.others !== true) throw fail('找不到这个设备，或它就是当前设备', 404);
    for (const tokenHash of targets) {
      stmt('DELETE FROM sessions WHERE token_hash=?').run(tokenHash);
      stmt('DELETE FROM session_devices WHERE token_hash=?').run(tokenHash);
      for (const socket of sockets) if (socket.sessionHash === tokenHash) socket.close(4001, 'session-revoked');
    }
    res.json({ revoked: targets.length });
  });
  app.get('/api/state', (req, res) => res.json(stateFor(req.user)));
  app.post('/api/remove-member', (req, res) => {
    if (req.user.id !== ownerId()) throw fail('只有空间创建者可以移除成员', 403);
    const id = req.body?.userId;
    if (typeof id !== 'string' || !id || id.length > 100) throw fail('请选择有效成员');
    if (id === req.user.id) throw fail('不能移除空间创建者', 403);
    if (!userById(id)) throw fail('成员不存在或已被移除', 404);
    db.exec('BEGIN');
    try {
      stmt('INSERT INTO removed_users (user_id,removed_at) VALUES (?,?)').run(id, Date.now());
      stmt('UPDATE workspace SET invite_code=? WHERE id=1').run(randomBytes(6).toString('hex').toUpperCase());
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    for (const socket of sockets) if (socket.userId === id) socket.close(4003, 'removed');
    broadcast({ type: 'users', users: users() });
    broadcast({ type: 'rooms' });
    res.json({ ok: true });
  });
  app.post('/api/recall-message', (req, res) => {
    rateLimit(req, 'recall', 60);
    const id = req.body?.messageId;
    if (typeof id !== 'string' || !id || id.length > 100) throw fail('消息标识无效');
    const row = stmt('SELECT * FROM messages WHERE id=?').get(id);
    if (!row) throw fail('消息不存在或已被清空', 404);
    requireRoom(row.room_id, req.user.id);
    if (row.sender_id !== req.user.id) throw fail('只能撤回自己发送的消息', 403);
    recallMessage(row);
    res.json({ message: { ...serializeMessage(stmt('SELECT * FROM messages WHERE id=?').get(id)), readBy: [] } });
  });
  // 撤回与管理员删除共用：清空正文和附件，删掉相关的已读、引用、提及、回应等记录，并通知会话里的人。
  const recallMessage = (row, removedBy) => {
    const id = row.id;
    if (!recalledAt(id)) {
      db.exec('BEGIN');
      try {
        if (removedBy) stmt('INSERT OR IGNORE INTO message_removals VALUES (?,?,?)').run(id, removedBy.id, Date.now());
        stmt('DELETE FROM room_pins WHERE message_id=?').run(id);
        stmt('DELETE FROM polls WHERE message_id=?').run(id);
        stmt('DELETE FROM poll_votes WHERE message_id=?').run(id);
        for (const file of JSON.parse(row.attachments)) for (const id of [file.id, file.thumbId].filter(Boolean)) {
          stmt('INSERT OR IGNORE INTO pending_file_deletions (id) VALUES (?)').run(id);
          stmt('DELETE FROM uploads WHERE id=?').run(id);
        }
        stmt('INSERT INTO message_recalls VALUES (?,?)').run(id, Date.now());
        stmt("UPDATE messages SET text='', attachments='[]' WHERE id=?").run(id);
        stmt('DELETE FROM message_reads WHERE message_id=?').run(id);
        stmt('DELETE FROM message_replies WHERE message_id=?').run(id);
        stmt('DELETE FROM message_mentions WHERE message_id=?').run(id);
        stmt('DELETE FROM message_reactions WHERE message_id=?').run(id);
        stmt('DELETE FROM message_forwards WHERE message_id=?').run(id);
        stmt('DELETE FROM message_edits WHERE message_id=?').run(id);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      cleanFiles();
      broadcast({ type: 'message-recalled', message: serializeMessage(stmt('SELECT * FROM messages WHERE id=?').get(id)) }, row.room_id);
      const root = threadOf(id);
      if (root) broadcast({ type: 'message-thread', roomId: row.room_id, rootId: root, thread: threadInfo(root) }, row.room_id);
    }
  };
  // 空间管理者：账号模式是管理员和超级管理员，局域网模式是空间创建者。
  const isManager = user => cloud ? ['admin', 'super_admin'].includes(user.role) : user.id === ownerId();
  const requireManager = req => { if (!isManager(req.user)) throw fail('只有管理员可以这样操作', 403); };
  // 管理员删除任何人的消息，记入操作日志（只记消息和会话标识，不保留被删的内容）。
  app.post('/api/admin/delete-message', (req, res) => {
    requireManager(req);
    rateLimit(req, 'admin-delete', 60);
    const id = req.body?.messageId;
    const row = typeof id === 'string' && id.length <= 100 && stmt('SELECT * FROM messages WHERE id=?').get(id);
    if (!row || row.seq <= clearedThroughSeq()) throw fail('消息不存在或已被清空', 404);
    if (recalledAt(row.id)) throw fail('消息已撤回');
    const room = stmt('SELECT * FROM rooms WHERE id=?').get(row.room_id);
    if (room.kind === 'direct' && !JSON.parse(room.members).includes(req.user.id)) throw fail('管理员不能查看或删除别人的私聊', 403);
    recallMessage(row, req.user);
    stmt('INSERT INTO account_audit (actor_id,user_id,action,detail,created_at) VALUES (?,?,?,?,?)').run(req.user.id, row.sender_id, 'delete-message', JSON.stringify({ messageId: row.id, roomId: row.room_id, roomName: room.name }), Date.now());
    res.json({ message: serializeMessage(stmt('SELECT * FROM messages WHERE id=?').get(row.id)) });
  });
  // 禁言与解除：minutes 为 0 或不传表示一直禁言；不能禁言自己和其他管理者。
  app.post('/api/admin/mute', (req, res) => {
    requireManager(req);
    const target = typeof req.body?.userId === 'string' && userById(req.body.userId);
    if (!target || target.id === req.user.id) throw fail('请选择有效成员');
    const targetRole = cloud ? stmt('SELECT role FROM accounts WHERE user_id=?').get(target.id)?.role : (target.id === ownerId() ? 'owner' : 'user');
    if (targetRole && targetRole !== 'user') throw fail('不能禁言管理员', 403);
    if (req.body.muted === false) {
      stmt('DELETE FROM member_mutes WHERE user_id=?').run(target.id);
      stmt('INSERT INTO account_audit (actor_id,user_id,action,detail,created_at) VALUES (?,?,?,?,?)').run(req.user.id, target.id, 'unmute', '', Date.now());
    } else {
      const minutes = Number(req.body.minutes || 0);
      if (!Number.isInteger(minutes) || minutes < 0 || minutes > 525600) throw fail('禁言时长无效');
      const until = minutes ? Date.now() + minutes * 60000 : null;
      stmt('INSERT OR REPLACE INTO member_mutes VALUES (?,?,?,?)').run(target.id, until, req.user.id, Date.now());
      stmt('INSERT INTO account_audit (actor_id,user_id,action,detail,created_at) VALUES (?,?,?,?,?)').run(req.user.id, target.id, 'mute', minutes ? `${minutes} 分钟` : '直到解除', Date.now());
    }
    broadcast({ type: 'users', users: users() });
    deliver({ type: 'rooms' }, socket => socket.userId === target.id);
    res.json({ ok: true });
  });
  // 消息保留期限：0 表示永久；设置后由定时任务删除更早的消息和附件。
  app.post('/api/admin/retention', (req, res) => {
    requireManager(req);
    const days = Number(req.body?.days);
    if (![0, 30, 90, 180, 365].includes(days)) throw fail('保留期限只能是 30、90、180、365 天或永久');
    stmt("INSERT OR REPLACE INTO space_settings VALUES ('retention_days', ?)").run(String(days));
    stmt('INSERT INTO account_audit (actor_id,user_id,action,detail,created_at) VALUES (?,?,?,?,?)').run(req.user.id, req.user.id, 'retention', days ? `${days} 天` : '永久', Date.now());
    broadcast({ type: 'rooms' });
    res.json({ retentionDays: days });
  });
  // 操作日志：账号审核、角色、密码与删除消息等管理操作，最新的在前，每页 50 条。
  app.get('/api/admin/audit', (req, res) => {
    requireManager(req);
    const page = Math.max(1, Math.min(100000, Number(req.query.page) || 1));
    const total = stmt('SELECT COUNT(*) AS n FROM account_audit').get().n;
    const names = new Map(stmt('SELECT id, name FROM users').all().map(user => [user.id, user.name]));
    const rows = stmt('SELECT * FROM account_audit ORDER BY id DESC LIMIT 50 OFFSET ?').all((page - 1) * 50);
    res.json({ total, page, entries: rows.map(row => ({ id: row.id, action: row.action, createdAt: row.created_at, detail: row.detail,
      actor: { id: row.actor_id, name: names.get(row.actor_id) || '已删除的成员' },
      target: { id: row.user_id, name: row.user_id.startsWith('webhook:') ? '机器人' : names.get(row.user_id) || '已删除的成员' } })) });
  });
  // 编辑自己发的消息：只改正文；@提及只保留正文里仍写着的，不新增提醒，避免借编辑反复打扰别人。
  app.post('/api/edit-message', (req, res) => {
    rateLimit(req, 'edit', 60);
    const id = req.body?.messageId;
    if (typeof id !== 'string' || !id || id.length > 100) throw fail('消息标识无效');
    const row = stmt('SELECT * FROM messages WHERE id=?').get(id);
    if (!row || row.seq <= clearedThroughSeq()) throw fail('消息不存在或已被清空', 404);
    requireRoom(row.room_id, req.user.id);
    if (row.sender_id !== req.user.id) throw fail('只能编辑自己发送的消息', 403);
    if (pollOf(id)) throw fail('投票不能编辑');
    if (recalledAt(id)) throw fail('消息已撤回');
    const text = typeof req.body.text === 'string' ? req.body.text.trim() : '';
    if (text.length > 10000) throw fail('每条消息最多 10000 个字符');
    if (!text && row.attachments === '[]') throw fail('消息不能为空');
    if (text !== row.text) {
      const kept = mentionsOf(id).filter(target => target === '*' ? text.includes('@所有人') : text.includes(`@${userById(target)?.name}`));
      db.exec('BEGIN');
      try {
        stmt('UPDATE messages SET text=? WHERE id=?').run(text, id);
        stmt('DELETE FROM message_mentions WHERE message_id=?').run(id);
        for (const target of kept) stmt('INSERT INTO message_mentions VALUES (?,?)').run(id, target);
        stmt('INSERT OR REPLACE INTO message_edits VALUES (?,?)').run(id, Date.now());
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      broadcast({ type: 'message-edited', message: serializeMessage(stmt('SELECT * FROM messages WHERE id=?').get(id)) }, row.room_id);
    }
    res.json({ message: withReads([serializeMessage(stmt('SELECT * FROM messages WHERE id=?').get(id))])[0] });
  });
  app.get('/api/storage', (req, res) => {
    if (req.user.id !== ownerId()) throw fail('只有空间创建者可以管理聊天记录', 403);
    res.json(storage());
  });
  app.post('/api/clear-history', (req, res) => {
    if (req.user.id !== ownerId()) throw fail('只有空间创建者可以清空聊天记录', 403);
    if (req.body?.confirmation !== '清空') throw fail('请输入“清空”确认删除');
    const before = storage();
    const throughSeq = Math.max(clearedThroughSeq(), stmt('SELECT COALESCE(MAX(seq),0) AS n FROM messages').get().n);
    db.exec('BEGIN');
    try {
      db.exec("INSERT OR IGNORE INTO pending_file_deletions SELECT id FROM uploads WHERE purpose IN ('message','thumbnail') AND claimed=1");
      db.exec("DELETE FROM uploads WHERE purpose IN ('message','thumbnail') AND claimed=1; DELETE FROM upload_thumbnails; DELETE FROM message_reads; DELETE FROM message_recalls; DELETE FROM message_replies; DELETE FROM message_mentions; DELETE FROM message_reactions; DELETE FROM message_forwards; DELETE FROM message_bots; DELETE FROM message_edits; DELETE FROM message_removals; DELETE FROM room_pins; DELETE FROM saved_messages; DELETE FROM polls; DELETE FROM poll_votes; DELETE FROM message_threads; DELETE FROM messages;");
      stmt('UPDATE history_state SET cleared_through_seq=? WHERE id=1').run(throughSeq);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    cleanFiles();
    broadcast({ type: 'history-cleared', throughSeq });
    let compacted = true;
    try { db.exec('PRAGMA wal_checkpoint(TRUNCATE); VACUUM; PRAGMA wal_checkpoint(TRUNCATE);'); }
    catch { compacted = false; }
    const after = storage();
    res.json({ ok: true, throughSeq, compacted, storage: after,
      freedBytes: Math.max(0, before.attachmentBytes + before.databaseBytes + before.pendingBytes - after.attachmentBytes - after.databaseBytes - after.pendingBytes) });
  });
  app.post('/api/unread-counts', (req, res) => {
    const cursors = req.body?.cursors;
    if (!cursors || typeof cursors !== 'object' || Array.isArray(cursors) ||
      Object.entries(cursors).some(([id, seq]) => !id || id.length > 100 || !Number.isSafeInteger(seq) || seq < 0)) throw fail('已读位置无效');
    const count = stmt(`SELECT COALESCE(MAX(seq), ?) AS throughSeq,
      COALESCE(SUM(CASE WHEN sender_id<>? AND id NOT IN (SELECT message_id FROM message_recalls) THEN 1 ELSE 0 END), 0) AS unreadCount,
      COALESCE(SUM(CASE WHEN sender_id<>? AND id NOT IN (SELECT message_id FROM message_recalls)
        AND EXISTS (SELECT 1 FROM message_mentions WHERE message_id=messages.id AND user_id IN (?, '*')) THEN 1 ELSE 0 END), 0) AS mentionCount
      FROM messages WHERE room_id=? AND seq>? AND ${NOT_THREAD}`);
    const rooms = stmt('SELECT id, kind, members FROM rooms').all().filter(room => canAccess(room, req.user.id));
    res.json({ rooms: rooms.map(room => {
      const afterSeq = Object.hasOwn(cursors, room.id) ? cursors[room.id] : 0;
      return { id: room.id, afterSeq, ...count.get(afterSeq, req.user.id, req.user.id, req.user.id, room.id, afterSeq) };
    }) });
  });
  app.get('/api/invite', (_req, res) => {
    const space = workspace();
    if (cloud) return res.json({ mode, url: process.env.CHAT_PUBLIC_URL || [...allowedOrigins][0], spaceName: space.name });
    res.json({ code: space.invite_code, spaceName: space.name, addresses: lanAddresses(server.address().port) });
  });
  app.post('/api/message-reads', (req, res) => {
    rateLimit(req, 'message-reads', 240);
    const room = requireRoom(req.body?.roomId, req.user.id);
    const ids = req.body?.messageIds;
    if (!Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some(id => typeof id !== 'string' || !id || id.length > 100)) throw fail('已读消息无效');
    const unique = [...new Set(ids)];
    const rows = stmt(`SELECT id, sender_id, room_id FROM messages WHERE id IN (${unique.map(() => '?').join(',')})`).all(...unique);
    if (rows.length !== unique.length || rows.some(row => row.room_id !== room.id)) throw fail('消息不属于这个会话', 403);
    const received = rows.filter(row => row.sender_id !== req.user.id && !recalledAt(row.id));
    const changed = [];
    const insert = stmt('INSERT OR IGNORE INTO message_reads (message_id,user_id,read_at) VALUES (?,?,?)');
    db.exec('BEGIN');
    try {
      for (const row of received) if (insert.run(row.id, req.user.id, Date.now()).changes) changed.push(row.id);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    const receipt = { roomId: room.id, userId: req.user.id, messageIds: received.map(row => row.id) };
    if (changed.length) broadcast({ type: 'message-reads', ...receipt, messageIds: changed }, room.id);
    res.json(receipt);
  });
  // 逐条转发到另一个会话：按原顺序生成新消息；附件为目标会话另建记录（同一文件用硬链接，失败时复制），
  // 这样目标会话的成员不需要访问原会话就能下载，任一边撤回也只删除自己那一份。
  app.post('/api/forward', (req, res) => {
    requireVoice(req.user);
    rateLimit(req, 'forward', 20);
    const target = requireRoom(req.body?.roomId, req.user.id);
    const ids = req.body?.messageIds;
    if (!Array.isArray(ids) || !ids.length || ids.length > 50 || ids.some(id => typeof id !== 'string' || !id || id.length > 100)) throw fail('请选择要转发的消息');
    const unique = [...new Set(ids)];
    const rows = stmt(`SELECT * FROM messages WHERE id IN (${unique.map(() => '?').join(',')}) ORDER BY seq`).all(...unique);
    if (rows.length !== unique.length || rows.some(row => row.seq <= clearedThroughSeq() || recalledAt(row.id))) throw fail('有消息已撤回或已被清空', 404);
    for (const row of rows) requireRoom(row.room_id, req.user.id);
    const files = rows.flatMap(row => JSON.parse(row.attachments));
    if (cloud && files.length) {
      const used = stmt('SELECT COALESCE(SUM(size),0) AS n FROM uploads').get().n;
      if (used + files.reduce((sum, file) => sum + file.size, 0) > storageBudget) throw fail('空间存储不足，请联系管理员清理附件', 507);
    }
    const created = [], copied = [];
    db.exec('BEGIN');
    try {
      for (const row of rows) {
        const attachments = JSON.parse(row.attachments).map(file => {
          const id = randomUUID();
          try { linkSync(path.join(uploadDir, file.id), path.join(uploadDir, id)); } catch { copyFileSync(path.join(uploadDir, file.id), path.join(uploadDir, id)); }
          copied.push(id);
          stmt('INSERT INTO uploads (id,owner_id,room_id,name,mime,size,purpose,claimed,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id, req.user.id, target.id, file.name, file.mime, file.size, 'message', 1, Date.now());
          const { thumbId, ...rest } = file;
          return { ...rest, id };
        });
        const id = randomUUID();
        stmt('INSERT INTO messages (id,room_id,sender_id,text,attachments,client_id,created_at) VALUES (?,?,?,?,?,?,?)').run(id, target.id, req.user.id, row.text, JSON.stringify(attachments), `forward:${randomUUID()}`, Date.now());
        const original = stmt('SELECT original_sender, original_created_at FROM message_forwards WHERE message_id=?').get(row.id);
        stmt('INSERT INTO message_forwards VALUES (?,?,?)').run(id, original?.original_sender || row.sender_id, original?.original_created_at || row.created_at);
        created.push(id);
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      for (const id of copied) { try { unlinkSync(path.join(uploadDir, id)); } catch {} }
      throw error;
    }
    const messages = created.map(id => ({ ...serializeMessage(stmt('SELECT * FROM messages WHERE id=?').get(id)), readBy: [] }));
    for (const message of messages) broadcast({ type: 'message', message }, target.id);
    res.status(201).json({ messages });
  });
  // 再点一次同一个表情即取消。
  app.post('/api/reactions', (req, res) => {
    rateLimit(req, 'reactions', 120);
    const { messageId, emoji } = req.body || {};
    if (typeof messageId !== 'string' || messageId.length > 100 || !REACTIONS.includes(emoji)) throw fail('表情回应无效');
    const row = stmt('SELECT * FROM messages WHERE id=?').get(messageId);
    if (!row || row.seq <= clearedThroughSeq()) throw fail('消息不存在或已被清空', 404);
    requireRoom(row.room_id, req.user.id);
    if (recalledAt(row.id)) throw fail('消息已撤回');
    const removed = stmt('DELETE FROM message_reactions WHERE message_id=? AND user_id=? AND emoji=?').run(row.id, req.user.id, emoji).changes;
    if (!removed) stmt('INSERT INTO message_reactions VALUES (?,?,?,?)').run(row.id, req.user.id, emoji, Date.now());
    const event = { roomId: row.room_id, messageId: row.id, reactions: reactionsOf(row.id) };
    broadcast({ type: 'message-reactions', ...event }, row.room_id);
    res.json(event);
  });
  app.post('/api/profile', (req, res) => {
    rateLimit(req, 'profile', 20);
    const name = textValue(req.body.name, 24);
    if (!name) throw fail('昵称不能为空');
    const avatar = PRESETS.includes(req.body.avatar) ? req.body.avatar : req.user.avatar;
    stmt('UPDATE users SET name=?, avatar=? WHERE id=?').run(name, avatar, req.user.id);
    // 部门和签名可选；不传时保持原样。
    if (req.body.department !== undefined || req.body.bio !== undefined) {
      const current = stmt('SELECT * FROM user_profiles WHERE user_id=?').get(req.user.id);
      const department = req.body.department === undefined ? current?.department || '' : textValue(req.body.department, 40);
      const bio = req.body.bio === undefined ? current?.bio || '' : textValue(req.body.bio, 120);
      stmt('INSERT INTO user_profiles (user_id,department,bio,last_seen) VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET department=excluded.department, bio=excluded.bio').run(req.user.id, department, bio, current?.last_seen ?? null);
    }
    broadcast({ type: 'users', users: users() });
    const profile = stmt('SELECT department, bio FROM user_profiles WHERE user_id=?').get(req.user.id);
    res.json({ me: { ...userById(req.user.id), department: profile?.department || '', bio: profile?.bio || '' } });
  });
  app.post('/api/rooms', (req, res) => {
    rateLimit(req, 'rooms', 12);
    const target = typeof req.body.userId === 'string' && userById(req.body.userId);
    let room;
    if (target) {
      if (target.id === req.user.id) throw fail('选择另一位成员开始私聊');
      const members = [req.user.id, target.id].sort();
      const existing = stmt("SELECT * FROM rooms WHERE kind='direct' AND members=?").get(JSON.stringify(members));
      if (existing) return res.json({ id: existing.id });
      room = { id: randomUUID(), name: '', kind: 'direct', members };
    } else {
      if (req.body.userId) throw fail('成员不存在');
      const name = textValue(req.body.name, 24);
      if (!name) throw fail('请输入频道名称');
      const ids = Array.isArray(req.body.memberIds) ? [...new Set(req.body.memberIds)] : [];
      if (!ids.length || ids.length > 100 || ids.some(id => typeof id !== 'string' || !userById(id))) throw fail('请选择至少一位有效成员');
      room = { id: randomUUID(), name, kind: 'group', members: [...new Set([req.user.id, ...ids])] };
    }
    stmt('INSERT INTO rooms (id,name,kind,members,created_at) VALUES (?,?,?,?,?)').run(room.id, room.name, room.kind, JSON.stringify(room.members), Date.now());
    if (room.kind === 'group') saveSettings(room.id, { owner_id: req.user.id });
    broadcast({ type: 'rooms' }, room.id);
    res.status(201).json({ id: room.id });
  });
  // 群主改群名、写群公告（留空即撤下公告）。
  app.post('/api/room-settings', (req, res) => {
    rateLimit(req, 'room-settings', 30);
    const room = requireGroupOwner(req.body?.roomId, req.user.id);
    const { name, announcement } = req.body;
    if ((name !== undefined && typeof name !== 'string') || (announcement !== undefined && typeof announcement !== 'string') || (name === undefined && announcement === undefined)) throw fail('群设置无效');
    if (name !== undefined) {
      const value = textValue(name, 24);
      if (!value) throw fail('请输入群聊名称');
      stmt('UPDATE rooms SET name=? WHERE id=?').run(value, room.id);
    }
    if (announcement !== undefined) {
      if (announcement.trim().length > 500) throw fail('群公告最多 500 个字');
      const text = announcement.trim();
      saveSettings(room.id, { announcement: text, announcement_at: text ? Date.now() : null, announcement_by: text ? req.user.id : null });
    }
    broadcast({ type: 'rooms' }, room.id);
    res.json({ ok: true });
  });
  // 退出群聊：群主退出时由最早的成员接任；最后一个人退出后群聊对所有人不可见。
  app.post('/api/room-leave', (req, res) => {
    const room = requireRoom(req.body?.roomId, req.user.id);
    if (room.kind !== 'group') throw fail('只能退出群聊');
    const members = JSON.parse(room.members).filter(id => id !== req.user.id);
    const ownerId = groupSettings(room).ownerId;
    stmt('UPDATE rooms SET members=? WHERE id=?').run(JSON.stringify(members), room.id);
    if (ownerId === req.user.id) saveSettings(room.id, { owner_id: members[0] || null });
    broadcast({ type: 'rooms' }, room.id);
    deliver({ type: 'rooms' }, socket => socket.userId === req.user.id);
    res.json({ ok: true });
  });
  // 群机器人由群主管理；大厅由空间创建者或管理员管理；私聊不能添加。令牌只在创建或重置时返回一次。
  const requireHookManager = (roomId, user) => {
    const room = requireRoom(roomId, user.id);
    const manager = room.kind === 'group' ? groupSettings(room).ownerId === user.id
      : room.kind === 'public' && (user.id === ownerId() || ['admin', 'super_admin'].includes(user.role));
    if (!manager) throw fail(room.kind === 'direct' ? '私聊不能添加机器人' : '只有群主或管理员可以管理机器人', 403);
    return room;
  };
  const webhookById = (id, user) => {
    const webhook = typeof id === 'string' && stmt('SELECT * FROM webhooks WHERE id=?').get(id);
    if (!webhook) throw fail('机器人不存在', 404);
    requireHookManager(webhook.room_id, user);
    return webhook;
  };
  const issueToken = id => {
    const token = randomBytes(24).toString('hex');
    stmt('UPDATE webhooks SET token_hash=? WHERE id=?').run(hash(token), id);
    return { id, path: `/api/hooks/${id}/${token}` };
  };
  const hookView = row => ({ id: row.id, name: row.name, createdAt: row.created_at, createdBy: row.created_by });
  app.get('/api/webhooks', (req, res) => {
    const room = requireHookManager(req.query.roomId, req.user);
    res.json({ webhooks: stmt('SELECT * FROM webhooks WHERE room_id=? ORDER BY created_at').all(room.id).map(hookView) });
  });
  app.post('/api/webhooks', (req, res) => {
    rateLimit(req, 'webhooks', 20);
    const room = requireHookManager(req.body?.roomId, req.user);
    const name = textValue(req.body?.name, 24);
    if (!name) throw fail('给机器人起个名字');
    if (stmt('SELECT COUNT(*) AS n FROM webhooks WHERE room_id=?').get(room.id).n >= 10) throw fail('每个会话最多 10 个机器人');
    const id = randomUUID();
    stmt('INSERT INTO webhooks VALUES (?,?,?,?,?,?)').run(id, room.id, name, '', req.user.id, Date.now());
    res.status(201).json({ webhook: hookView(stmt('SELECT * FROM webhooks WHERE id=?').get(id)), ...issueToken(id) });
  });
  app.post('/api/webhooks/reset', (req, res) => {
    rateLimit(req, 'webhooks', 20);
    res.json(issueToken(webhookById(req.body?.id, req.user).id));
  });
  app.post('/api/webhooks/delete', (req, res) => {
    const webhook = webhookById(req.body?.id, req.user);
    stmt('DELETE FROM webhooks WHERE id=?').run(webhook.id);
    res.json({ ok: true });
  });
  // 群主把群主身份转给群里的另一位成员。
  app.post('/api/room-owner', (req, res) => {
    const room = requireGroupOwner(req.body?.roomId, req.user.id);
    const target = req.body?.userId;
    if (typeof target !== 'string' || target === req.user.id || !JSON.parse(room.members).includes(target) || !userById(target)) throw fail('请选择群里的另一位成员');
    saveSettings(room.id, { owner_id: target });
    broadcast({ type: 'rooms' }, room.id);
    res.json({ ok: true });
  });
  app.post('/api/room-members', (req, res) => {
    rateLimit(req, 'members', 20);
    const room = requireRoom(req.body.roomId, req.user.id);
    if (room.kind !== 'group') throw fail('只能向群聊邀请成员');
    const ids = Array.isArray(req.body.memberIds) ? [...new Set(req.body.memberIds)] : [];
    if (!ids.length || ids.length > 100 || ids.some(id => typeof id !== 'string' || !userById(id))) throw fail('请选择有效成员');
    const members = [...new Set([...JSON.parse(room.members), ...ids])];
    if (members.length > 100) throw fail('单个群聊最多 100 人');
    stmt('UPDATE rooms SET members=? WHERE id=?').run(JSON.stringify(members), room.id);
    broadcast({ type: 'rooms' }, room.id);
    res.json({ ok: true });
  });
  app.get('/api/messages', (req, res) => {
    const room = requireRoom(req.query.roomId, req.user.id);
    const before = Number(req.query.before) || Number.MAX_SAFE_INTEGER;
    const rows = stmt(`SELECT * FROM messages WHERE room_id=? AND seq<? AND ${NOT_THREAD} ORDER BY seq DESC LIMIT 51`).all(room.id, before);
    res.json({ messages: withReads(rows.slice(0, 50).reverse().map(serializeMessage)), hasMore: rows.length > 50 });
  });
  // 话题：根消息和它的全部回复（最多 500 条，按时间先后）。
  app.get('/api/thread', (req, res) => {
    const root = typeof req.query.rootId === 'string' && stmt('SELECT * FROM messages WHERE id=?').get(req.query.rootId);
    if (!root || root.seq <= clearedThroughSeq()) throw fail('话题不存在', 404);
    requireRoom(root.room_id, req.user.id);
    const replies = stmt('SELECT m.* FROM message_threads t JOIN messages m ON m.id=t.message_id WHERE t.root_id=? ORDER BY m.seq LIMIT 500').all(root.id);
    res.json({ root: withReads([serializeMessage(root)])[0], replies: withReads(replies.map(serializeMessage)) });
  });
  // 定时消息：最早 1 分钟后、最晚 30 天内；每人最多 50 条待发送。
  const timeValue = value => { const time = Number(value); if (!Number.isSafeInteger(time) || time < Date.now() + scheduleMinLead || time > Date.now() + 30 * 86400000) throw fail('时间需要在 1 分钟以后、30 天以内'); return time; };
  const scheduledView = row => ({ id: row.id, roomId: row.room_id, text: row.text, sendAt: row.send_at, createdAt: row.created_at });
  app.get('/api/scheduled', (req, res) => {
    const room = requireRoom(req.query.roomId, req.user.id);
    res.json({ items: stmt('SELECT * FROM scheduled_messages WHERE room_id=? AND sender_id=? ORDER BY send_at').all(room.id, req.user.id).map(scheduledView) });
  });
  app.post('/api/scheduled', (req, res) => {
    rateLimit(req, 'scheduled', 20);
    const room = requireRoom(req.body?.roomId, req.user.id);
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text || text.length > 10000) throw fail('请输入 1–10000 个字的消息');
    const sendAt = timeValue(req.body.sendAt);
    if (stmt('SELECT COUNT(*) AS n FROM scheduled_messages WHERE sender_id=?').get(req.user.id).n >= 50) throw fail('最多同时保留 50 条定时消息');
    const id = randomUUID();
    stmt('INSERT INTO scheduled_messages VALUES (?,?,?,?,?,?)').run(id, room.id, req.user.id, text, sendAt, Date.now());
    res.status(201).json({ item: scheduledView(stmt('SELECT * FROM scheduled_messages WHERE id=?').get(id)) });
  });
  app.post('/api/scheduled/cancel', (req, res) => {
    const removed = stmt('DELETE FROM scheduled_messages WHERE id=? AND sender_id=?').run(String(req.body?.id || ''), req.user.id).changes;
    if (!removed) throw fail('定时消息不存在或已发送', 404);
    res.json({ ok: true });
  });
  // 提醒我：到点通知自己；不在线就等下次连上时补发。
  app.post('/api/reminders', (req, res) => {
    rateLimit(req, 'reminders', 30);
    const message = typeof req.body?.messageId === 'string' && stmt('SELECT * FROM messages WHERE id=?').get(req.body.messageId);
    if (!message || message.seq <= clearedThroughSeq() || recalledAt(message.id)) throw fail('消息不存在或已撤回', 404);
    requireRoom(message.room_id, req.user.id);
    const remindAt = timeValue(req.body.remindAt);
    if (stmt('SELECT COUNT(*) AS n FROM reminders WHERE user_id=?').get(req.user.id).n >= 100) throw fail('最多同时保留 100 个提醒');
    const id = randomUUID();
    stmt('INSERT INTO reminders VALUES (?,?,?,?,?)').run(id, req.user.id, message.id, remindAt, Date.now());
    res.status(201).json({ id, remindAt });
  });
  // 到点发送定时消息、推送提醒：发送人已无权访问会话时直接丢弃。
  // 按保留期限删除过期消息：每小时最多跑一次，每次最多 500 条，附件文件随后清理。
  let retentionCheckedAt = 0;
  const MESSAGE_TABLES = ['message_reads', 'message_recalls', 'message_replies', 'message_mentions', 'message_reactions', 'message_forwards', 'message_edits', 'message_bots', 'message_removals', 'room_pins', 'saved_messages', 'polls', 'poll_votes', 'message_threads', 'reminders'];
  const purgeExpired = () => {
    const days = retentionDays();
    if (!days || Date.now() - retentionCheckedAt < 3600000) return 0;
    retentionCheckedAt = Date.now();
    const rows = stmt('SELECT id, attachments FROM messages WHERE created_at<? ORDER BY seq LIMIT 500').all(Date.now() - days * 86400000);
    if (!rows.length) return 0;
    db.exec('BEGIN');
    try {
      for (const row of rows) {
        for (const file of JSON.parse(row.attachments)) for (const id of [file.id, file.thumbId].filter(Boolean)) {
          stmt('INSERT OR IGNORE INTO pending_file_deletions (id) VALUES (?)').run(id);
          stmt('DELETE FROM uploads WHERE id=?').run(id);
          stmt('DELETE FROM upload_thumbnails WHERE upload_id=?').run(id);
        }
        for (const table of MESSAGE_TABLES) stmt(`DELETE FROM ${table} WHERE message_id=?`).run(row.id);
        stmt('DELETE FROM message_replies WHERE reply_to=?').run(row.id);
        stmt('DELETE FROM message_threads WHERE root_id=?').run(row.id);
        stmt('DELETE FROM messages WHERE id=?').run(row.id);
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    cleanFiles();
    if (rows.length === 500) retentionCheckedAt = 0;
    return rows.length;
  };
  const runSchedules = () => {
    const now = Date.now();
    purgeExpired();
    for (const row of stmt('SELECT * FROM scheduled_messages WHERE send_at<=? ORDER BY send_at').all(now)) {
      stmt('DELETE FROM scheduled_messages WHERE id=?').run(row.id);
      const room = stmt('SELECT * FROM rooms WHERE id=?').get(row.room_id);
      if (!canAccess(room, row.sender_id) || muteOf(row.sender_id)) continue;
      const id = randomUUID();
      stmt('INSERT INTO messages (id,room_id,sender_id,text,attachments,client_id,created_at) VALUES (?,?,?,?,?,?,?)').run(id, room.id, row.sender_id, row.text, '[]', `scheduled:${row.id}`, Date.now());
      broadcast({ type: 'message', message: { ...serializeMessage(stmt('SELECT * FROM messages WHERE id=?').get(id)), readBy: [] } }, room.id);
    }
    const online = onlineIds();
    for (const row of stmt('SELECT * FROM reminders WHERE remind_at<=?').all(now)) {
      const message = stmt('SELECT * FROM messages WHERE id=?').get(row.message_id);
      const room = message && stmt('SELECT * FROM rooms WHERE id=?').get(message.room_id);
      if (!message || recalledAt(message.id) || message.seq <= clearedThroughSeq() || !canAccess(room, row.user_id)) { stmt('DELETE FROM reminders WHERE id=?').run(row.id); continue; }
      if (!online.has(row.user_id)) continue;
      deliver({ type: 'reminder', message: serializeMessage(message) }, socket => socket.userId === row.user_id);
      stmt('DELETE FROM reminders WHERE id=?').run(row.id);
    }
  };
  // 投票：问题 1–200 字，选项 2–10 个、每个 1–100 字且不重复；可以单选或多选。
  app.post('/api/polls', (req, res) => {
    rateLimit(req, 'polls', 10);
    const room = requireRoom(req.body?.roomId, req.user.id);
    requireVoice(req.user);
    const question = textValue(req.body?.question, 200);
    const options = Array.isArray(req.body?.options) ? req.body.options.map(option => textValue(option, 100)).filter(Boolean) : [];
    if (!question) throw fail('请输入投票问题');
    if (options.length < 2 || options.length > 10 || new Set(options).size !== options.length) throw fail('请填写 2–10 个不重复的选项');
    const id = randomUUID();
    db.exec('BEGIN');
    try {
      stmt('INSERT INTO messages (id,room_id,sender_id,text,attachments,client_id,created_at) VALUES (?,?,?,?,?,?,?)').run(id, room.id, req.user.id, question, '[]', `poll:${id}`, Date.now());
      stmt('INSERT INTO polls VALUES (?,?,?,?)').run(id, JSON.stringify(options), req.body.multiple === true ? 1 : 0, null);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    const message = { ...serializeMessage(stmt('SELECT * FROM messages WHERE id=?').get(id)), readBy: [] };
    broadcast({ type: 'message', message }, room.id);
    res.status(201).json({ message });
  });
  const requirePoll = (req, id) => {
    const row = typeof id === 'string' && stmt('SELECT * FROM messages WHERE id=?').get(id);
    const poll = row && stmt('SELECT * FROM polls WHERE message_id=?').get(row.id);
    if (!poll || row.seq <= clearedThroughSeq()) throw fail('投票不存在', 404);
    requireRoom(row.room_id, req.user.id);
    return { row, poll };
  };
  const pollChanged = row => {
    const event = { roomId: row.room_id, messageId: row.id, poll: pollOf(row.id) };
    broadcast({ type: 'message-poll', ...event }, row.room_id);
    return event;
  };
  // 投票或改票：提交自己选中的全部选项，空数组表示撤回自己的投票。
  app.post('/api/polls/vote', (req, res) => {
    rateLimit(req, 'poll-vote', 60);
    const { row, poll } = requirePoll(req, req.body?.messageId);
    if (poll.closed_at) throw fail('投票已结束');
    const count = JSON.parse(poll.options).length;
    const choices = Array.isArray(req.body?.options) ? [...new Set(req.body.options)] : null;
    if (!choices || choices.some(index => !Number.isInteger(index) || index < 0 || index >= count) || (!poll.multiple && choices.length > 1)) throw fail('选项无效');
    db.exec('BEGIN');
    try {
      stmt('DELETE FROM poll_votes WHERE message_id=? AND user_id=?').run(row.id, req.user.id);
      for (const index of choices) stmt('INSERT INTO poll_votes VALUES (?,?,?,?)').run(row.id, req.user.id, index, Date.now());
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    res.json(pollChanged(row));
  });
  app.post('/api/polls/close', (req, res) => {
    const { row, poll } = requirePoll(req, req.body?.messageId);
    if (row.sender_id !== req.user.id) throw fail('只有发起人可以结束投票', 403);
    if (!poll.closed_at) stmt('UPDATE polls SET closed_at=? WHERE message_id=?').run(Date.now(), row.id);
    res.json(pollChanged(row));
  });
  // 收藏夹：最近收藏的在前，最多列 200 条；撤回、清空或已无权访问的消息不列出。
  app.get('/api/saved', (req, res) => {
    const rows = stmt(`SELECT s.saved_at AS savedAt, m.* FROM saved_messages s JOIN messages m ON m.id=s.message_id
      WHERE s.user_id=? AND m.seq>? AND m.id NOT IN (SELECT message_id FROM message_recalls) ORDER BY s.saved_at DESC LIMIT 200`).all(req.user.id, clearedThroughSeq());
    const rooms = new Map();
    const allowed = row => { if (!rooms.has(row.room_id)) rooms.set(row.room_id, stmt('SELECT * FROM rooms WHERE id=?').get(row.room_id)); return canAccess(rooms.get(row.room_id), req.user.id); };
    res.json({ items: rows.filter(allowed).map(row => ({ savedAt: row.savedAt, message: serializeMessage(row) })) });
  });
  app.post('/api/saved', (req, res) => {
    rateLimit(req, 'saved', 60);
    const message = typeof req.body?.messageId === 'string' && stmt('SELECT * FROM messages WHERE id=?').get(req.body.messageId);
    if (!message || message.seq <= clearedThroughSeq()) throw fail('消息不存在或已被清空', 404);
    requireRoom(message.room_id, req.user.id);
    if (req.body.saved === false) stmt('DELETE FROM saved_messages WHERE user_id=? AND message_id=?').run(req.user.id, message.id);
    else {
      if (recalledAt(message.id)) throw fail('消息已撤回');
      stmt('INSERT OR IGNORE INTO saved_messages VALUES (?,?,?)').run(req.user.id, message.id, Date.now());
    }
    deliver({ type: 'saved' }, socket => socket.userId === req.user.id);
    res.json({ ok: true });
  });
  // 会话内置顶消息。
  const canPin = (room, user) => room.kind === 'direct' || isManager(user) || (room.kind === 'group' && groupSettings(room).ownerId === user.id);
  const pinsOf = room => stmt(`SELECT p.pinned_by AS pinnedBy, p.pinned_at AS pinnedAt, m.* FROM room_pins p JOIN messages m ON m.id=p.message_id
    WHERE p.room_id=? AND m.seq>? ORDER BY p.pinned_at DESC`).all(room.id, clearedThroughSeq()).map(row => ({ pinnedBy: row.pinnedBy, pinnedAt: row.pinnedAt, message: serializeMessage(row) }));
  app.get('/api/room-pins', (req, res) => {
    const room = requireRoom(req.query.roomId, req.user.id);
    res.json({ pins: pinsOf(room), canPin: canPin(room, req.user) });
  });
  app.post('/api/room-pins', (req, res) => {
    rateLimit(req, 'pins', 30);
    const room = requireRoom(req.body?.roomId, req.user.id);
    if (!canPin(room, req.user)) throw fail('只有群主或管理员可以置顶消息', 403);
    const message = typeof req.body?.messageId === 'string' && stmt('SELECT * FROM messages WHERE id=?').get(req.body.messageId);
    if (!message || message.room_id !== room.id || message.seq <= clearedThroughSeq() || recalledAt(message.id)) throw fail('消息不存在或已撤回', 404);
    if (req.body.pinned === false) stmt('DELETE FROM room_pins WHERE room_id=? AND message_id=?').run(room.id, message.id);
    else {
      if (stmt('SELECT COUNT(*) AS n FROM room_pins WHERE room_id=?').get(room.id).n >= 20 && !stmt('SELECT 1 FROM room_pins WHERE room_id=? AND message_id=?').get(room.id, message.id)) throw fail('每个会话最多置顶 20 条消息');
      stmt('INSERT OR IGNORE INTO room_pins VALUES (?,?,?,?)').run(room.id, message.id, req.user.id, Date.now());
    }
    broadcast({ type: 'room-pins', roomId: room.id }, room.id);
    res.json({ pins: pinsOf(room) });
  });
  // 链接预览：按网址缓存；同一网址同时只抓一次。CHAT_LINK_PREVIEW=off 可以整体关闭。
  const previewing = new Map();
  app.get('/api/link-preview', async (req, res) => {
    if (process.env.CHAT_LINK_PREVIEW === 'off') throw fail('链接预览已关闭', 404);
    const raw = textValue(req.query.url, 2000);
    let url;
    try { url = new URL(raw); } catch { throw fail('链接无效'); }
    if (!['http:', 'https:'].includes(url.protocol)) throw fail('只能预览网页链接');
    const key = url.href;
    const cached = stmt('SELECT * FROM link_previews WHERE url=?').get(key);
    if (cached && Date.now() - cached.fetched_at < (cached.data ? 86400000 : 3600000)) {
      if (cached.data) return res.json({ preview: JSON.parse(cached.data) });
      throw fail(cached.error, 404);
    }
    rateLimit(req, 'link-preview', 30);
    if (!previewing.has(key)) previewing.set(key, previewFetcher(key).then(data => ({ data }), error => ({ error: error.message || '无法预览' })).finally(() => previewing.delete(key)));
    const result = await previewing.get(key);
    stmt('INSERT OR REPLACE INTO link_previews VALUES (?,?,?,?)').run(key, result.data ? JSON.stringify(result.data) : null, result.error || null, Date.now());
    if (!result.data) throw fail(result.error, 404);
    res.json({ preview: result.data });
  });
  // 导出单个会话为纯文本：只含自己有权访问的会话，按客户端时区显示时间；附件只列文件名和大小。
  app.get('/api/export', (req, res) => {
    rateLimit(req, 'export', 10);
    const room = requireRoom(req.query.roomId, req.user.id);
    const offset = Number(req.query.tz || 0);
    if (!Number.isInteger(offset) || Math.abs(offset) > 840) throw fail('时区无效');
    const time = value => new Date(value - offset * 60000).toISOString().slice(0, 16).replace('T', ' ');
    const names = new Map(stmt('SELECT id, name FROM users').all().map(user => [user.id, user.name]));
    const nameOf = id => names.get(id) || '已离开的成员';
    const senderOf = message => message.bot ? `${message.bot}（机器人）` : nameOf(message.senderId);
    const members = JSON.parse(room.members);
    const title = room.kind === 'direct' ? nameOf(members.find(id => id !== req.user.id) || req.user.id) : room.name;
    const blocks = [];
    for (const row of stmt('SELECT * FROM messages WHERE room_id=? AND seq>? ORDER BY seq').iterate(room.id, clearedThroughSeq())) {
      const message = serializeMessage(row);
      const lines = [`${time(message.createdAt)}  ${senderOf(message)}${message.forwardedFrom ? `（转发自 ${nameOf(message.forwardedFrom.senderId)}）` : ''}${message.editedAt ? '（已编辑）' : ''}`];
      if (message.recalledAt) lines.push(message.removedBy ? '（消息已被管理员删除）' : '（消息已撤回）');
      else {
        const quote = message.replyTo;
        if (quote) lines.push(`↪ 回复 ${quote.senderId ? nameOf(quote.senderId) : ''}：${quote.missing ? '原消息已不存在' : quote.recalled ? '原消息已撤回' : quote.text.replace(/\s+/g, ' ').slice(0, 40) || '[附件]'}`);
        if (message.poll) lines.push(`[投票${message.poll.multiple ? '，多选' : ''}${message.poll.closedAt ? '，已结束' : ''}] ${message.text}`, ...message.poll.options.map(option => `  · ${option.text}：${option.voters.length} 票`));
        else if (message.text) lines.push(message.text);
        for (const file of message.attachments) lines.push(`[附件] ${file.name}（${sizeText(file.size)}）`);
      }
      blocks.push(lines.join('\n'));
    }
    const header = `虾扯蛋聊天记录\n会话：${title}\n导出时间：${time(Date.now())} · 共 ${blocks.length} 条消息`;
    const date = time(Date.now()).slice(0, 10).replace(/-/g, '');
    res.set({ 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`虾扯蛋-${title}-${date}.txt`)}` });
    res.send([header, ...blocks].join('\n\n') + '\n');
  });
  // 会话里发过的图片、视频和文件，最新的在前；撤回或已清空的不列出。
  app.get('/api/room-files', (req, res) => {
    const room = requireRoom(req.query.roomId, req.user.id);
    const kind = req.query.kind === 'file' ? 'file' : 'media';
    const before = Number(req.query.before) || Number.MAX_SAFE_INTEGER;
    const media = "json_extract(f.value, '$.mime') LIKE 'image/%' OR json_extract(f.value, '$.mime') LIKE 'video/%'";
    const rows = stmt(`SELECT m.id AS messageId, m.seq, m.sender_id AS senderId, m.created_at AS createdAt, f.value AS file FROM messages m, json_each(m.attachments) f
      WHERE m.room_id=? AND m.seq>? AND m.seq<? AND m.id NOT IN (SELECT message_id FROM message_recalls) AND ${kind === 'media' ? `(${media})` : `NOT (${media})`}
      ORDER BY m.seq DESC, f.key LIMIT 61`).all(room.id, clearedThroughSeq(), before);
    res.json({ items: rows.slice(0, 60).map(row => ({ ...row, file: JSON.parse(row.file) })), hasMore: rows.length > 60 });
  });
  // 只读检索文字与附件文件名：带 roomId 时只查该会话，否则查自己能访问的全部会话；撤回与已清空的消息不会命中。
  app.get('/api/search', (req, res) => {
    const roomIds = req.query.roomId === undefined
      ? stmt('SELECT * FROM rooms').all().filter(room => canAccess(room, req.user.id)).map(room => room.id)
      : [requireRoom(req.query.roomId, req.user.id).id];
    const query = textValue(req.query.q, 100);
    // 可选筛选：发送人、时间范围（毫秒时间戳）、类型（图片、视频、文件、链接）；有筛选时关键词可以为空。
    const filters = [], args = [];
    if (typeof req.query.sender === 'string' && req.query.sender) { filters.push('sender_id=?'); args.push(req.query.sender.slice(0, 100)); }
    for (const [key, op] of [['from', '>='], ['to', '<=']]) if (req.query[key] !== undefined) {
      const time = Number(req.query[key]);
      if (!Number.isSafeInteger(time)) throw fail('时间范围无效');
      filters.push(`created_at${op}?`); args.push(time);
    }
    const kinds = { image: "json_extract(value, '$.mime') LIKE 'image/%'", video: "json_extract(value, '$.mime') LIKE 'video/%'",
      file: "json_extract(value, '$.mime') NOT LIKE 'image/%' AND json_extract(value, '$.mime') NOT LIKE 'video/%'" };
    if (req.query.type !== undefined) {
      if (req.query.type === 'link') filters.push("(text LIKE '%http://%' OR text LIKE '%https://%')");
      else if (kinds[req.query.type]) filters.push(`EXISTS (SELECT 1 FROM json_each(messages.attachments) WHERE ${kinds[req.query.type]})`);
      else throw fail('类型无效');
    }
    if ((!query && !filters.length) || !roomIds.length) return res.json({ messages: [] });
    rateLimit(req, 'search', 120);
    const pattern = `%${query.replace(/[\\%_]/g, char => `\\${char}`)}%`;
    const keyword = query ? "AND (text LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM json_each(messages.attachments) WHERE json_extract(value, '$.name') LIKE ? ESCAPE '\\'))" : '';
    const rows = stmt(`SELECT * FROM messages WHERE room_id IN (${roomIds.map(() => '?').join(',')}) AND seq>? AND id NOT IN (SELECT message_id FROM message_recalls)
      ${keyword} ${filters.map(filter => `AND ${filter}`).join(' ')}
      ORDER BY seq DESC LIMIT 50`).all(...roomIds, clearedThroughSeq(), ...(query ? [pattern, pattern] : []), ...args);
    res.json({ messages: rows.map(serializeMessage) });
  });
  const upload = multer({ storage: multer.diskStorage({ destination: uploadDir, filename: (_req, _file, cb) => cb(null, randomUUID()) }), limits: { fileSize: MAX_FILE, files: 1, fields: 4 } });
  // 缩略图只能挂在自己刚上传、还没发送的图片上，本身也必须是 2 MB 以内的静态图片。
  const thumbnailTarget = req => {
    const target = typeof req.query.thumbnailFor === 'string' && stmt('SELECT * FROM uploads WHERE id=?').get(req.query.thumbnailFor);
    if (!target || target.owner_id !== req.user.id || target.claimed || target.purpose !== 'message' || target.room_id !== req.query.roomId || !target.mime.startsWith('image/')) throw fail('缩略图对应的图片无效');
    return target;
  };
  const saveThumbnail = (req, file) => {
    const target = thumbnailTarget(req);
    const mime = detectMime(file.path);
    if (!['image/jpeg', 'image/webp', 'image/png'].includes(mime) || file.size > 2 * 1024 * 1024) throw fail('缩略图格式无效');
    stmt('INSERT INTO uploads (id,owner_id,room_id,name,mime,size,purpose,claimed,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(file.filename, req.user.id, target.room_id, 'thumbnail', mime, file.size, 'thumbnail', 0, Date.now());
    const previous = stmt('SELECT thumb_id FROM upload_thumbnails WHERE upload_id=?').get(target.id);
    if (previous) { stmt('INSERT OR IGNORE INTO pending_file_deletions (id) VALUES (?)').run(previous.thumb_id); stmt('DELETE FROM uploads WHERE id=?').run(previous.thumb_id); }
    stmt('INSERT OR REPLACE INTO upload_thumbnails VALUES (?,?)').run(target.id, file.filename);
    return { id: file.filename, size: file.size };
  };
  app.post('/api/uploads', (req, res, next) => {
    rateLimit(req, 'upload', 30);
    // 授权发生在接收文件之前，防止向无权限会话写入磁盘。
    if (req.query.purpose !== 'avatar') requireRoom(req.query.roomId, req.user.id);
    if (req.query.thumbnailFor !== undefined) thumbnailTarget(req);
    // 每人存储上限（CHAT_MAX_USER_BYTES，可选）：超出后不能再上传，删除或清理后恢复。
    const userQuota = Number(process.env.CHAT_MAX_USER_BYTES || 0);
    if (userQuota > 0 && stmt('SELECT COALESCE(SUM(size),0) AS n FROM uploads WHERE owner_id=?').get(req.user.id).n >= userQuota) throw fail('你的存储空间已用完，请联系管理员', 507);
    if (cloud) {
      if (activeUploads >= 4) throw fail('上传服务繁忙，请稍后重试', 429);
      const used = stmt('SELECT COALESCE(SUM(size),0) AS n FROM uploads').get().n;
      if (used + (activeUploads + 1) * MAX_FILE > storageBudget) throw fail('空间存储不足，请联系管理员清理附件', 507);
      activeUploads++;
      let released = false;
      const release = () => { if (!released) { released = true; activeUploads--; } };
      res.once('finish', release); res.once('close', release);
    }
    upload.single('file')(req, res, next);
  }, (req, res) => {
    const file = req.file;
    if (!file) throw fail('请选择要发送的文件');
    try {
      if (isRemoved(req.user.id) || (cloud && !auth.user(req))) throw fail('账号已失效，请重新登录', 401);
      const isAvatar = req.query.purpose === 'avatar';
      if (req.query.thumbnailFor !== undefined) return res.status(201).json({ thumbnail: saveThumbnail(req, file) });
      // 能识别为图片或视频的才在页面内预览，其余一律作为普通文件，只允许下载。
      const mime = detectMime(file.path) || (isAvatar ? null : 'application/octet-stream');
      if (!mime || (isAvatar && (!mime.startsWith('image/') || file.size > 5 * 1024 * 1024))) throw fail('头像请使用 5 MB 以内的 JPG、PNG、GIF 或 WebP 图片');
      const attachment = { id: file.filename, name: textValue(Buffer.from(file.originalname, 'latin1').toString('utf8'), 200), mime, size: file.size };
      stmt('INSERT INTO uploads (id,owner_id,room_id,name,mime,size,purpose,claimed,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(attachment.id, req.user.id, isAvatar ? null : req.query.roomId, attachment.name, mime, file.size, isAvatar ? 'avatar' : 'message', isAvatar ? 1 : 0, Date.now());
      if (isAvatar) {
        stmt('UPDATE users SET avatar=? WHERE id=?').run(`upload:${attachment.id}`, req.user.id);
        broadcast({ type: 'users', users: users() });
      }
      res.status(201).json({ attachment, ...(isAvatar ? { me: userById(req.user.id) } : {}) });
    } catch (error) { try { unlinkSync(file.path); } catch {} throw error; }
  });
  app.post('/api/messages', (req, res) => {
    rateLimit(req, 'messages', 120);
    const room = requireRoom(req.body.roomId, req.user.id);
    requireVoice(req.user);
    const clientId = textValue(req.body.clientId, 80);
    if (!clientId) throw fail('消息标识缺失，请重试');
    const existing = stmt('SELECT * FROM messages WHERE sender_id=? AND client_id=?').get(req.user.id, clientId);
    if (existing) return res.json({ message: withReads([serializeMessage(existing)])[0] });
    const messageText = typeof req.body.text === 'string' ? req.body.text.trim() : '';
    if (messageText.length > 10000) throw fail('每条消息最多 10000 个字符');
    const ids = Array.isArray(req.body.attachmentIds) ? [...new Set(req.body.attachmentIds)] : [];
    if (ids.length > 6) throw fail('每条消息最多 6 个附件');
    const attachments = ids.map(id => {
      if (typeof id !== 'string') throw fail('附件无效');
      const file = stmt('SELECT * FROM uploads WHERE id=?').get(id);
      if (!file || file.owner_id !== req.user.id || file.room_id !== room.id || file.purpose !== 'message' || file.claimed) throw fail('附件不可用，请重新选择');
      const thumb = stmt('SELECT thumb_id FROM upload_thumbnails WHERE upload_id=?').get(file.id)?.thumb_id;
      return { id: file.id, name: file.name, mime: file.mime, size: file.size, ...(thumb ? { thumbId: thumb } : {}) };
    });
    if (!messageText && !attachments.length) throw fail('消息不能为空');
    // 只能引用同一会话里仍然可见的消息，避免借引用读取其他会话的内容。
    const replyTo = req.body.replyTo === undefined || req.body.replyTo === null ? null : req.body.replyTo;
    if (replyTo !== null) {
      const target = typeof replyTo === 'string' && replyTo.length <= 100 && stmt('SELECT * FROM messages WHERE id=?').get(replyTo);
      if (!target || target.room_id !== room.id || target.seq <= clearedThroughSeq() || recalledAt(target.id)) throw fail('引用的消息不可用');
    }
    // 话题回复：根消息必须是同一会话里仍可见的普通消息（话题里的回复不能再开话题）。
    const threadRoot = req.body.threadOf === undefined || req.body.threadOf === null ? null : req.body.threadOf;
    if (threadRoot !== null) {
      const root = typeof threadRoot === 'string' && threadRoot.length <= 100 && stmt('SELECT * FROM messages WHERE id=?').get(threadRoot);
      if (!root || root.room_id !== room.id || root.seq <= clearedThroughSeq() || recalledAt(root.id) || threadOf(root.id)) throw fail('话题不可用');
    }
    // @提及必须是会话成员且正文里确实写了「@名字」，避免看不见的提醒；@所有人在群聊里人人可用，大厅仅空间管理者可用。
    const mentionInput = req.body.mentions === undefined ? [] : req.body.mentions;
    if (!Array.isArray(mentionInput) || mentionInput.length > 50 || mentionInput.some(value => typeof value !== 'string')) throw fail('提及的成员无效');
    const mentions = [...new Set(mentionInput)];
    for (const target of mentions) {
      if (target === '*') {
        const manager = req.user.id === ownerId() || ['admin', 'super_admin'].includes(req.user.role);
        if (room.kind === 'direct' || (room.kind === 'public' && !manager)) throw fail('这里不能 @所有人', 403);
        if (!messageText.includes('@所有人')) throw fail('提及的成员无效');
        continue;
      }
      const member = userById(target);
      if (!member || target === req.user.id || !canAccess(room, target) || !messageText.includes(`@${member.name}`)) throw fail('提及的成员无效');
    }
    const id = randomUUID();
    db.exec('BEGIN');
    try {
      stmt('INSERT INTO messages (id,room_id,sender_id,text,attachments,client_id,created_at) VALUES (?,?,?,?,?,?,?)').run(id, room.id, req.user.id, messageText, JSON.stringify(attachments), clientId, Date.now());
      for (const file of attachments) stmt('UPDATE uploads SET claimed=1 WHERE id IN (?,?)').run(file.id, file.thumbId || file.id);
      if (replyTo) stmt('INSERT INTO message_replies VALUES (?,?)').run(id, replyTo);
      if (threadRoot) stmt('INSERT INTO message_threads VALUES (?,?)').run(id, threadRoot);
      for (const target of mentions) stmt('INSERT INTO message_mentions VALUES (?,?)').run(id, target);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    const message = { ...serializeMessage(stmt('SELECT * FROM messages WHERE id=?').get(id)), readBy: [] };
    broadcast({ type: 'message', message }, room.id);
    if (threadRoot) broadcast({ type: 'message-thread', roomId: room.id, rootId: threadRoot, thread: threadInfo(threadRoot) }, room.id);
    res.status(201).json({ message });
  });
  app.get('/api/media', (req, res) => {
    const file = typeof req.query.id === 'string' && stmt('SELECT * FROM uploads WHERE id=?').get(req.query.id);
    if (!file) throw fail('文件不存在', 404);
    if (file.purpose === 'message' || file.purpose === 'thumbnail') {
      requireRoom(file.room_id, req.user.id);
      if (!file.claimed && file.owner_id !== req.user.id) throw fail('文件尚未发送', 403);
    }
    // 普通文件只能下载：不按文件内容渲染，也不允许执行脚本。
    const previewable = /^(image|video)\//.test(file.mime);
    res.set('Content-Type', previewable ? file.mime : 'application/octet-stream');
    if (!previewable) res.set('Content-Security-Policy', "sandbox; default-src 'none'");
    if (!previewable || req.query.download === '1') res.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    res.sendFile(path.join(uploadDir, file.id));
  });
  app.post('/api/logout', (req, res) => {
    for (const socket of sockets) if (socket.userId === req.user.id) socket.close(4001, 'logout');
    stmt('UPDATE users SET token_hash=? WHERE id=?').run(hash(randomBytes(32)), req.user.id);
    stmt('DELETE FROM user_devices WHERE user_id=?').run(req.user.id);
    res.clearCookie('linliao_session', { path: '/' });
    res.json({ ok: true });
  });
  app.use('/api', (_req, _res, next) => next(fail('接口不存在', 404)));
  if (serveWeb) app.use(express.static(path.join(root, 'dist'), { etag: true }));
  app.use((error, req, res, _next) => {
    if (req.file && error instanceof multer.MulterError) { try { unlinkSync(req.file.path); } catch {} }
    const status = error.status || (error instanceof multer.MulterError ? 400 : 500);
    if (status >= 500) console.error({ message: error.message, code: error.code });
    res.status(status).json({ error: error.code === 'LIMIT_FILE_SIZE' ? '单个文件不能超过 100 MB' : status === 507 ? '空间存储不足，请联系管理员清理附件' : status >= 500 ? '操作未完成，请稍后重试' : error.message });
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  server.on('upgrade', (req, socket, head) => {
    const user = authUser(req);
    if (req.url !== '/socket' || !originOK(req) || !user) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
    if (sockets.size >= 1024 || [...sockets].filter(item => item.userId === user.id).length >= 10) { socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n'); socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => {
      ws.userId = user.id;
      if (cloud) ws.sessionHash = auth.tokenHash(req);
      ws.alive = true;
      sockets.add(ws);
      ws.on('pong', () => { ws.alive = true; });
      // 「正在输入」只转发不保存：每个连接两秒内最多一次，只发给同一会话里的其他人。
      ws.on('message', data => {
        let event;
        try { event = JSON.parse(data); } catch { return; }
        if (event?.type !== 'typing' || typeof event.roomId !== 'string' || event.roomId.length > 100) return;
        if (Date.now() - (ws.typedAt || 0) < 2000) return;
        const room = stmt('SELECT * FROM rooms WHERE id=?').get(event.roomId);
        if (!canAccess(room, ws.userId) || (cloud && !auth.validSocket(ws))) return;
        ws.typedAt = Date.now();
        deliver({ type: 'typing', roomId: room.id, userId: ws.userId }, socket => socket.userId !== ws.userId && canAccess(room, socket.userId));
      });
      ws.on('error', () => ws.terminate());
      ws.on('close', () => {
        sockets.delete(ws);
        if (!closing && ![...sockets].some(socket => socket.userId === ws.userId)) stmt('INSERT INTO user_profiles (user_id,last_seen) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET last_seen=excluded.last_seen').run(ws.userId, Date.now());
        if (!closing) broadcast({ type: 'users', users: users() });
      });
      ws.send(JSON.stringify({ type: 'ready' }));
      broadcast({ type: 'users', users: users() });
    });
  });
  const scheduler = setInterval(runSchedules, scheduleInterval);
  scheduler.unref();
  const heartbeat = setInterval(() => {
    for (const socket of sockets) {
      if (cloud && !auth.validSocket(socket)) socket.close(4001, 'session-expired');
      else if (!socket.alive) socket.terminate();
      else { socket.alive = false; socket.ping(); }
    }
    cleanFiles();
    auth?.cleanup();
    for (const [key, value] of limits) if (value.until < Date.now()) limits.delete(key);
    for (const [key, value] of failures) if (value.until < Date.now()) failures.delete(key);
    const old = stmt('SELECT id FROM uploads WHERE claimed=0 AND created_at<?').all(Date.now() - 86400000);
    for (const file of old) { try { unlinkSync(path.join(uploadDir, file.id)); } catch {} stmt('DELETE FROM uploads WHERE id=?').run(file.id); stmt('DELETE FROM upload_thumbnails WHERE upload_id=? OR thumb_id=?').run(file.id, file.id); }
  }, 30000);
  heartbeat.unref();
  try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); }); }
  catch (error) { clearInterval(heartbeat); clearInterval(scheduler); wss.close(); db.close(); throw error; }
  const address = `http://127.0.0.1:${server.address().port}`;
  return { server, address, setupUrl: `${address}/#setup=${setupKey}`, close: async () => {
    if (closing) return;
    closing = true;
    clearInterval(heartbeat);
    clearInterval(scheduler);
    for (const socket of sockets) socket.terminate();
    wss.close();
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    db.close();
  } };
}

// Node 以真实路径加载入口模块，经符号链接（如 macOS 的 /tmp）启动时 argv[1] 需先解析再比较。
const entryPath = value => { try { return realpathSync(value); } catch { return path.resolve(value); } };
if (process.argv[1] && entryPath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const running = await startServer({ port: Number(process.env.PORT) || 4318, host: process.env.HOST || '0.0.0.0', dataDir: process.env.CHAT_DATA_DIR || path.join(root, '.data') });
  console.log(`虾扯蛋已启动：${process.env.CHAT_MODE === 'cloud' || process.env.NODE_ENV === 'production' ? running.address : running.setupUrl}`);
  const shutdown = async () => { await running.close(); process.exit(0); };
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, shutdown);
  // 桌面端以子进程启动时，父进程退出（包括崩溃）会关闭标准输入，此时随之退出，避免遗留进程占用端口。
  if (process.env.LINLIAO_EXIT_WITH_STDIN === '1') { process.stdin.on('end', shutdown); process.stdin.resume(); }
}
