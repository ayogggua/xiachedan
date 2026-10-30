import express from 'express';
import multer from 'multer';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'node:http';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { mkdirSync, unlinkSync, openSync, readSync, closeSync, statSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore, serializeMessage as baseMessage } from './store.js';
import { lanAddresses } from './network.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_FILE = 100 * 1024 * 1024;
const PRESETS = ['cat', 'bird', 'rabbit', 'fish', 'coffee', 'mountain', 'planet', 'sprout'];
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const textValue = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
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

export async function startServer({ dataDir = path.join(root, '.data'), port = 4318, host = '0.0.0.0' } = {}) {
  const db = openStore(dataDir);
  const uploadDir = path.join(dataDir, 'uploads');
  mkdirSync(uploadDir, { recursive: true, mode: 0o700 });
  const setupKey = randomBytes(32).toString('hex');
  const app = express();
  const server = createServer(app);
  const sockets = new Set();
  let closing = false;
  const failures = new Map();
  const limits = new Map();
  const stmt = sql => db.prepare(sql);
  const recalledAt = id => stmt('SELECT recalled_at FROM message_recalls WHERE message_id=?').get(id)?.recalled_at || null;
  const serializeMessage = row => row ? { ...baseMessage(row), recalledAt: recalledAt(row.id) } : null;
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
  const spaceInfo = () => ({ name: workspace().name, ownerId: ownerId() });
  const userById = id => stmt('SELECT id, name, avatar FROM users WHERE id=? AND id NOT IN (SELECT user_id FROM removed_users)').get(id);
  const tokenFrom = req => {
    const cookie = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith('linliao_session='));
    return cookie ? cookie.slice('linliao_session='.length) : '';
  };
  const authUser = req => {
    const token = tokenFrom(req);
    return token ? stmt('SELECT id, name, avatar FROM users WHERE token_hash=? AND id NOT IN (SELECT user_id FROM removed_users)').get(hash(token)) : null;
  };
  const canAccess = (room, userId) => room && !isRemoved(userId) && (room.kind === 'public' || JSON.parse(room.members).includes(userId));
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
    return stmt('SELECT id, name, avatar FROM users ORDER BY created_at').all().map(user => ({ ...user, removed: isRemoved(user.id), online: !isRemoved(user.id) && online.has(user.id) }));
  };
  const roomsFor = userId => stmt('SELECT * FROM rooms ORDER BY created_at').all()
    .filter(room => canAccess(room, userId)).map(room => ({ id: room.id, name: room.name, kind: room.kind,
      members: JSON.parse(room.members), lastMessage: serializeMessage(stmt('SELECT * FROM messages WHERE room_id=? ORDER BY seq DESC LIMIT 1').get(room.id)) }));
  const stateFor = user => {
    const rooms = roomsFor(user.id);
    const allowed = new Set(rooms.map(room => room.id));
    const recalls = stmt('SELECT m.id, m.room_id AS roomId, r.recalled_at AS recalledAt FROM message_recalls r JOIN messages m ON m.id=r.message_id').all().filter(row => allowed.has(row.roomId));
    return { me: user, workspace: spaceInfo(), users: users(), rooms, recalls, clearedThroughSeq: clearedThroughSeq() };
  };
  const broadcast = (event, roomId) => {
    const payload = JSON.stringify(event);
    const room = roomId ? stmt('SELECT * FROM rooms WHERE id=?').get(roomId) : null;
    for (const socket of sockets) if (socket.readyState === WebSocket.OPEN && !isRemoved(socket.userId) && (!roomId || canAccess(room, socket.userId))) socket.send(payload);
  };
  const userCreated = (req, res, name, avatar) => {
    const token = randomBytes(32).toString('hex');
    const user = { id: randomUUID(), name, avatar: PRESETS.includes(avatar) ? avatar : 'cat' };
    stmt('INSERT INTO users (id,name,avatar,token_hash,created_at) VALUES (?,?,?,?,?)').run(user.id, name, user.avatar, hash(token), Date.now());
    res.cookie('linliao_session', token, { httpOnly: true, sameSite: 'strict', maxAge: 90 * 86400000, path: '/' });
    broadcast({ type: 'users', users: users() });
    return user;
  };
  const rateLimit = (req, key, max, duration = 60000) => {
    const id = `${req.user?.id || req.socket.remoteAddress}:${key}`;
    const current = limits.get(id);
    if (!current || current.until < Date.now()) limits.set(id, { count: 1, until: Date.now() + duration });
    else if (++current.count > max) throw fail('操作有些频繁，稍后再试', 429);
  };
  const originOK = req => !req.headers.origin || req.headers.origin === `http://${req.headers.host}`;
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" });
    if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && (!originOK(req) || req.get('X-Linliao') !== '1')) return next(fail('请求来源无效', 403));
    next();
  });
  app.use(express.json({ limit: '64kb' }));
  app.get('/api/health', (_req, res) => res.json({ app: 'linliao', version: '1.3.0' }));
  app.get('/api/bootstrap', (req, res) => {
    const ws = workspace();
    const me = authUser(req);
    res.json({ configured: Boolean(ws), workspace: ws ? spaceInfo() : null,
      canCreate: loopback(req.socket.remoteAddress) && req.get('X-Setup-Key') === setupKey,
      me, ...(me ? stateFor(me) : {}) });
  });
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
  app.use('/api', (req, _res, next) => {
    req.user = authUser(req);
    next(req.user ? undefined : fail('请先加入空间', 401));
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
    if (!recalledAt(id)) {
      db.exec('BEGIN');
      try {
        for (const file of JSON.parse(row.attachments)) {
          stmt('INSERT OR IGNORE INTO pending_file_deletions (id) VALUES (?)').run(file.id);
          stmt('DELETE FROM uploads WHERE id=?').run(file.id);
        }
        stmt('INSERT INTO message_recalls VALUES (?,?)').run(id, Date.now());
        stmt("UPDATE messages SET text='', attachments='[]' WHERE id=?").run(id);
        stmt('DELETE FROM message_reads WHERE message_id=?').run(id);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      cleanFiles();
      broadcast({ type: 'message-recalled', message: serializeMessage(stmt('SELECT * FROM messages WHERE id=?').get(id)) }, row.room_id);
    }
    res.json({ message: { ...serializeMessage(stmt('SELECT * FROM messages WHERE id=?').get(id)), readBy: [] } });
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
      db.exec("INSERT OR IGNORE INTO pending_file_deletions SELECT id FROM uploads WHERE purpose='message' AND claimed=1");
      db.exec("DELETE FROM uploads WHERE purpose='message' AND claimed=1; DELETE FROM message_reads; DELETE FROM message_recalls; DELETE FROM messages;");
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
      COALESCE(SUM(CASE WHEN sender_id<>? AND id NOT IN (SELECT message_id FROM message_recalls) THEN 1 ELSE 0 END), 0) AS unreadCount
      FROM messages WHERE room_id=? AND seq>?`);
    const rooms = stmt('SELECT id, kind, members FROM rooms').all().filter(room => canAccess(room, req.user.id));
    res.json({ rooms: rooms.map(room => {
      const afterSeq = Object.hasOwn(cursors, room.id) ? cursors[room.id] : 0;
      return { id: room.id, afterSeq, ...count.get(afterSeq, req.user.id, room.id, afterSeq) };
    }) });
  });
  app.get('/api/invite', (_req, res) => {
    const space = workspace();
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
  app.post('/api/profile', (req, res) => {
    rateLimit(req, 'profile', 20);
    const name = textValue(req.body.name, 24);
    if (!name) throw fail('昵称不能为空');
    const avatar = PRESETS.includes(req.body.avatar) ? req.body.avatar : req.user.avatar;
    stmt('UPDATE users SET name=?, avatar=? WHERE id=?').run(name, avatar, req.user.id);
    broadcast({ type: 'users', users: users() });
    res.json({ me: userById(req.user.id) });
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
    broadcast({ type: 'rooms' }, room.id);
    res.status(201).json({ id: room.id });
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
    const rows = stmt('SELECT * FROM messages WHERE room_id=? AND seq<? ORDER BY seq DESC LIMIT 51').all(room.id, before);
    res.json({ messages: withReads(rows.slice(0, 50).reverse().map(serializeMessage)), hasMore: rows.length > 50 });
  });
  // 只读检索当前会话的文字与附件文件名；撤回与已清空的消息不会命中。
  app.get('/api/search', (req, res) => {
    const room = requireRoom(req.query.roomId, req.user.id);
    const query = textValue(req.query.q, 100);
    if (!query) return res.json({ messages: [] });
    rateLimit(req, 'search', 120);
    const pattern = `%${query.replace(/[\\%_]/g, char => `\\${char}`)}%`;
    const rows = stmt(`SELECT * FROM messages WHERE room_id=? AND seq>? AND id NOT IN (SELECT message_id FROM message_recalls)
      AND (text LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM json_each(messages.attachments) WHERE json_extract(value, '$.name') LIKE ? ESCAPE '\\'))
      ORDER BY seq DESC LIMIT 50`).all(room.id, clearedThroughSeq(), pattern, pattern);
    res.json({ messages: rows.map(serializeMessage) });
  });
  const upload = multer({ storage: multer.diskStorage({ destination: uploadDir, filename: (_req, _file, cb) => cb(null, randomUUID()) }), limits: { fileSize: MAX_FILE, files: 1, fields: 4 } });
  app.post('/api/uploads', (req, res, next) => {
    rateLimit(req, 'upload', 30);
    // 授权发生在接收文件之前，防止向无权限会话写入磁盘。
    if (req.query.purpose !== 'avatar') requireRoom(req.query.roomId, req.user.id);
    upload.single('file')(req, res, next);
  }, (req, res) => {
    const file = req.file;
    if (!file) throw fail('请选择图片或视频');
    try {
      if (isRemoved(req.user.id)) throw fail('你已被移出空间', 401);
      const mime = detectMime(file.path);
      const isAvatar = req.query.purpose === 'avatar';
      if (!mime || (isAvatar && (!mime.startsWith('image/') || file.size > 5 * 1024 * 1024))) throw fail(isAvatar ? '头像请使用 5 MB 以内的 JPG、PNG、GIF 或 WebP 图片' : '支持 JPG、PNG、GIF、WebP、MP4、MOV 和 WebM 文件');
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
      return { id: file.id, name: file.name, mime: file.mime, size: file.size };
    });
    if (!messageText && !attachments.length) throw fail('消息不能为空');
    const id = randomUUID();
    db.exec('BEGIN');
    try {
      stmt('INSERT INTO messages (id,room_id,sender_id,text,attachments,client_id,created_at) VALUES (?,?,?,?,?,?,?)').run(id, room.id, req.user.id, messageText, JSON.stringify(attachments), clientId, Date.now());
      for (const file of attachments) stmt('UPDATE uploads SET claimed=1 WHERE id=?').run(file.id);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    const message = { ...serializeMessage(stmt('SELECT * FROM messages WHERE id=?').get(id)), readBy: [] };
    broadcast({ type: 'message', message }, room.id);
    res.status(201).json({ message });
  });
  app.get('/api/media', (req, res) => {
    const file = typeof req.query.id === 'string' && stmt('SELECT * FROM uploads WHERE id=?').get(req.query.id);
    if (!file) throw fail('文件不存在', 404);
    if (file.purpose === 'message') {
      requireRoom(file.room_id, req.user.id);
      if (!file.claimed && file.owner_id !== req.user.id) throw fail('文件尚未发送', 403);
    }
    res.set('Content-Type', file.mime);
    if (req.query.download === '1') res.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    res.sendFile(path.join(uploadDir, file.id));
  });
  app.post('/api/logout', (req, res) => {
    for (const socket of sockets) if (socket.userId === req.user.id) socket.close(4001, 'logout');
    stmt('UPDATE users SET token_hash=? WHERE id=?').run(hash(randomBytes(32)), req.user.id);
    res.clearCookie('linliao_session', { path: '/' });
    res.json({ ok: true });
  });
  app.use('/api', (_req, _res, next) => next(fail('接口不存在', 404)));
  app.use(express.static(path.join(root, 'dist'), { etag: true }));
  app.use((error, req, res, _next) => {
    if (req.file && error instanceof multer.MulterError) { try { unlinkSync(req.file.path); } catch {} }
    const status = error.status || (error instanceof multer.MulterError ? 400 : 500);
    if (status >= 500) console.error(error);
    res.status(status).json({ error: error.code === 'LIMIT_FILE_SIZE' ? '单个文件不能超过 100 MB' : status >= 500 ? '操作未完成，请稍后重试' : error.message });
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  server.on('upgrade', (req, socket, head) => {
    const user = authUser(req);
    if (req.url !== '/socket' || !originOK(req) || !user) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => {
      ws.userId = user.id;
      ws.alive = true;
      sockets.add(ws);
      ws.on('pong', () => { ws.alive = true; });
      ws.on('error', () => ws.terminate());
      ws.on('close', () => { sockets.delete(ws); if (!closing) broadcast({ type: 'users', users: users() }); });
      ws.send(JSON.stringify({ type: 'ready' }));
      broadcast({ type: 'users', users: users() });
    });
  });
  const heartbeat = setInterval(() => {
    for (const socket of sockets) {
      if (!socket.alive) socket.terminate();
      else { socket.alive = false; socket.ping(); }
    }
    cleanFiles();
    for (const [key, value] of limits) if (value.until < Date.now()) limits.delete(key);
    for (const [key, value] of failures) if (value.until < Date.now()) failures.delete(key);
    const old = stmt('SELECT id FROM uploads WHERE claimed=0 AND created_at<?').all(Date.now() - 86400000);
    for (const file of old) { try { unlinkSync(path.join(uploadDir, file.id)); } catch {} stmt('DELETE FROM uploads WHERE id=?').run(file.id); }
  }, 30000);
  heartbeat.unref();
  try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); }); }
  catch (error) { clearInterval(heartbeat); wss.close(); db.close(); throw error; }
  const address = `http://127.0.0.1:${server.address().port}`;
  return { server, address, setupUrl: `${address}/#setup=${setupKey}`, close: async () => {
    if (closing) return;
    closing = true;
    clearInterval(heartbeat);
    for (const socket of sockets) socket.terminate();
    wss.close();
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    db.close();
  } };
}

// Node 以真实路径加载入口模块，经符号链接（如 macOS 的 /tmp）启动时 argv[1] 需先解析再比较。
const entryPath = value => { try { return realpathSync(value); } catch { return path.resolve(value); } };
if (process.argv[1] && entryPath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const running = await startServer({ port: Number(process.env.PORT) || 4318, dataDir: process.env.CHAT_DATA_DIR || path.join(root, '.data') });
  console.log(`虾扯蛋已启动：${running.setupUrl}`);
  const shutdown = async () => { await running.close(); process.exit(0); };
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, shutdown);
  // 桌面端以子进程启动时，父进程退出（包括崩溃）会关闭标准输入，此时随之退出，避免遗留进程占用端口。
  if (process.env.LINLIAO_EXIT_WITH_STDIN === '1') { process.stdin.on('end', shutdown); process.stdin.resume(); }
}
