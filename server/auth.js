import { randomBytes, randomUUID, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import { isPresetAvatar } from '../shared/avatars.js';

const derive = promisify(scrypt);
const ADMIN_PHONE = '19977167586';
const SESSION_MS = 7 * 86400000;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const hash = value => createHash('sha256').update(value).digest('hex');

function identifier(value) {
  if (typeof value !== 'string' || value.length > 254) throw fail('请输入有效的手机号或邮箱');
  let result = value.trim().toLowerCase();
  if (/^(?:\+86|0086)1\d{10}$/.test(result)) result = result.replace(/^(?:\+86|0086)/, '');
  if (/^1[3-9]\d{9}$/.test(result)) return { column: 'phone', value: result };
  if (/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(result)) return { column: 'email', value: result };
  throw fail('请输入有效的手机号或邮箱');
}

function validatePassword(value) {
  if (typeof value !== 'string' || value.length < 10 || value.length > 128) throw fail('密码需要 10–128 个字符');
  if (!/[a-zA-Z]/.test(value) || !/\d/.test(value)) throw fail('密码需要同时包含字母和数字');
}

// OWASP scrypt 基线：N=2^15、r=8、p=3；异步计算并限制并发，避免堵塞聊天服务。
async function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  const key = await derive(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${salt}$${key.toString('hex')}`;
}

async function verify(password, encoded) {
  if (typeof password !== 'string' || password.length > 128) return false;
  const [method, salt, expected] = encoded.split('$');
  if (method !== 'scrypt' || !/^[0-9a-f]{128}$/.test(expected || '')) return false;
  const actual = (await passwordHash(password, salt)).split('$')[2];
  return timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

export async function createAuth({ db, app, production, closeUser, changed, rateLimit }) {
  const stmt = sql => db.prepare(sql);
  const secure = production;
  const sameSite = process.env.CHAT_COOKIE_SAME_SITE || 'lax';
  if (!['lax', 'strict', 'none'].includes(sameSite) || (sameSite === 'none' && !secure)) throw new Error('CHAT_COOKIE_SAME_SITE 配置无效');
  const cookieName = secure ? '__Host-xiachedan_session' : 'xiachedan_session';
  const cookieOptions = { httpOnly: true, secure, sameSite, path: '/' };
  const publicAccount = row => row ? {
    id: row.id, name: row.name, avatar: row.avatar, phone: row.phone, email: row.email,
    role: row.role, status: row.status, mustChangePassword: Boolean(row.must_change_password),
    createdAt: row.created_at, reviewedAt: row.reviewed_at,
  } : null;
  const accountSQL = 'SELECT u.id,u.name,u.avatar,u.created_at,a.* FROM accounts a JOIN users u ON u.id=a.user_id';
  const account = id => stmt(`${accountSQL} WHERE u.id=?`).get(id);
  const token = req => {
    const value = req.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    return /^[0-9a-f]{64}$/.test(value || '') ? value : '';
  };
  const session = req => {
    const value = token(req);
    if (!value) return null;
    const row = stmt('SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?').get(hash(value), Date.now());
    return row ? account(row.user_id) : null;
  };
  const active = row => Boolean(row && row.status === 'approved' && !row.must_change_password && !stmt('SELECT 1 FROM removed_users WHERE user_id=?').get(row.id));
  const user = req => { const row = session(req); return active(row) ? publicAccount(row) : null; };
  const setSession = (res, id) => {
    const value = randomBytes(32).toString('hex');
    stmt('DELETE FROM sessions WHERE expires_at<=?').run(Date.now());
    stmt('INSERT INTO sessions VALUES (?,?,?,?)').run(hash(value), id, Date.now(), Date.now() + SESSION_MS);
    stmt('DELETE FROM sessions WHERE user_id=? AND token_hash NOT IN (SELECT token_hash FROM sessions WHERE user_id=? ORDER BY created_at DESC LIMIT 10)').run(id, id);
    res.cookie(cookieName, value, { ...cookieOptions, maxAge: SESSION_MS });
  };
  const audit = (actor, id, action, detail = '') => stmt('INSERT INTO account_audit (actor_id,user_id,action,detail,created_at) VALUES (?,?,?,?,?)').run(actor, id, action, detail, Date.now());
  const transaction = fn => {
    db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); db.exec('COMMIT'); return value; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const existingAdmin = stmt('SELECT * FROM accounts WHERE phone=?').get(ADMIN_PHONE);
  if (existingAdmin && existingAdmin.role !== 'super_admin') throw new Error('超级管理员账号状态异常，请检查数据');
  if (!existingAdmin) {
    const password = process.env.CHAT_ADMIN_PASSWORD_FILE ? readFileSync(process.env.CHAT_ADMIN_PASSWORD_FILE, 'utf8').trim() : process.env.CHAT_ADMIN_INITIAL_PASSWORD;
    if (!password) throw new Error('首次启动需要 CHAT_ADMIN_PASSWORD_FILE 或 CHAT_ADMIN_INITIAL_PASSWORD');
    validatePassword(password);
    const encoded = await passwordHash(password);
    transaction(() => {
      const id = randomUUID();
      stmt('INSERT INTO users VALUES (?,?,?,?,?)').run(id, '管理员', 'cat', hash(randomBytes(32)), Date.now());
      stmt("INSERT INTO accounts (user_id,phone,password_hash,role,status,must_change_password,updated_at) VALUES (?,?,?,'super_admin','approved',1,?)").run(id, ADMIN_PHONE, encoded, Date.now());
      stmt('INSERT OR IGNORE INTO workspace VALUES (1,?,?)').run(process.env.CHAT_SPACE_NAME?.trim().slice(0, 32) || '虾扯蛋', randomBytes(6).toString('hex').toUpperCase());
      stmt("INSERT OR IGNORE INTO rooms (id,name,kind,created_at) VALUES ('lobby','大厅','public',?)").run(Date.now());
      stmt('INSERT OR REPLACE INTO space_admin VALUES (1,?)').run(id);
    });
  }
  const dummyHash = await passwordHash(randomBytes(32).toString('hex'));
  let hashing = 0;
  const withHashSlot = async fn => {
    if (hashing >= 4) throw fail('登录服务繁忙，请稍后重试', 429);
    hashing++;
    try { return await fn(); } finally { hashing--; }
  };
  const requireSession = req => {
    const row = session(req);
    if (!row) throw fail('请先登录', 401);
    return row;
  };
  const requireAdmin = req => {
    const row = requireSession(req);
    if (!active(row) || !['admin', 'super_admin'].includes(row.role)) throw fail('需要管理员权限', 403);
    rateLimit(req, 'admin', 120);
    return row;
  };
  const managedAccount = (req, actor) => {
    const id = req.body?.userId;
    if (typeof id !== 'string' || id.length > 100) throw fail('请选择有效用户');
    const target = account(id);
    if (!target) throw fail('用户不存在', 404);
    if (target.id === actor.id || target.role === 'super_admin' || (actor.role !== 'super_admin' && target.role !== 'user')) throw fail('不能修改此账号', 403);
    return target;
  };

  app.post('/api/auth/register', async (req, res) => {
    rateLimit(req, 'register', 20, 15 * 60000);
    const login = identifier(req.body?.identifier);
    validatePassword(req.body?.password);
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name || name.length > 24) throw fail('昵称需要 1–24 个字符');
    if (login.value === ADMIN_PHONE || stmt(`SELECT 1 FROM accounts WHERE ${login.column}=?`).get(login.value)) throw fail('该账号已注册，请直接登录', 409);
    const encoded = await withHashSlot(() => passwordHash(req.body.password));
    const id = randomUUID();
    try {
      transaction(() => {
        stmt('INSERT INTO users VALUES (?,?,?,?,?)').run(id, name, isPresetAvatar(req.body.avatar) ? req.body.avatar : 'cat', hash(randomBytes(32)), Date.now());
        stmt(`INSERT INTO accounts (user_id,${login.column},password_hash,updated_at) VALUES (?,?,?,?)`).run(id, login.value, encoded, Date.now());
      });
    } catch (error) { if (String(error.code).includes('CONSTRAINT') || error.errcode === 2067) throw fail('该账号已注册，请直接登录', 409); throw error; }
    setSession(res, id);
    res.status(201).json({ account: publicAccount(account(id)) });
  });
  app.post('/api/auth/login', async (req, res) => {
    rateLimit(req, 'login', 60, 15 * 60000);
    const login = identifier(req.body?.identifier);
    rateLimit(req, `login-account:${hash(login.value)}`, 10, 15 * 60000, `account:${hash(login.value)}`);
    const row = stmt(`${accountSQL} WHERE a.${login.column}=?`).get(login.value);
    const valid = await withHashSlot(() => verify(req.body?.password, row?.password_hash || dummyHash));
    if (!row || !valid) throw fail('手机号、邮箱或密码不正确', 401);
    // 哈希计算期间账号状态可能被管理员修改，返回最新状态。
    setSession(res, row.id);
    res.json({ account: publicAccount(account(row.id)) });
  });
  app.get('/api/auth/me', (req, res) => res.json({ account: publicAccount(requireSession(req)) }));
  app.post('/api/auth/logout', (req, res) => {
    const value = token(req);
    if (value) {
      stmt('DELETE FROM sessions WHERE token_hash=?').run(hash(value));
      closeUser(null, hash(value));
    }
    res.clearCookie(cookieName, cookieOptions);
    res.json({ ok: true });
  });
  app.post('/api/auth/password', async (req, res) => {
    const row = requireSession(req);
    rateLimit(req, 'password', 6, 15 * 60000);
    validatePassword(req.body?.password);
    if (req.body.password === req.body.currentPassword) throw fail('新密码不能与原密码相同');
    const encoded = await withHashSlot(async () => {
      if (!await verify(req.body?.currentPassword, row.password_hash)) throw fail('原密码不正确', 403);
      return passwordHash(req.body.password);
    });
    transaction(() => {
      // 防止同一旧密码的并发请求覆盖刚更新的密码。
      const result = stmt('UPDATE accounts SET password_hash=?,must_change_password=0,updated_at=? WHERE user_id=? AND password_hash=?').run(encoded, Date.now(), row.id, row.password_hash);
      if (!result.changes) throw fail('密码已更新，请重新登录', 409);
      stmt('DELETE FROM sessions WHERE user_id=?').run(row.id);
      audit(row.id, row.id, 'password');
    });
    setSession(res, row.id);
    res.json({ account: publicAccount(account(row.id)) });
    setImmediate(() => closeUser(row.id));
  });
  app.get('/api/admin/users', (req, res) => {
    requireAdmin(req);
    const status = req.query.status || 'pending';
    if (!['pending', 'approved', 'rejected', 'suspended', 'all'].includes(status)) throw fail('审核状态无效');
    const page = Math.max(1, Math.min(100000, Number(req.query.page) || 1));
    if (!Number.isInteger(page)) throw fail('页码无效');
    const where = status === 'all' ? '' : ' WHERE a.status=?';
    const args = status === 'all' ? [] : [status];
    const total = stmt(`SELECT COUNT(*) AS n FROM accounts a${where}`).get(...args).n;
    const rows = stmt(`${accountSQL}${where} ORDER BY u.created_at DESC,u.id LIMIT 50 OFFSET ?`).all(...args, (page - 1) * 50);
    res.json({ users: rows.map(publicAccount), total, page, pageSize: 50 });
  });
  app.post('/api/admin/review', (req, res) => {
    const actor = requireAdmin(req);
    const target = managedAccount(req, actor);
    const status = req.body?.status;
    if (!['approved', 'rejected', 'suspended'].includes(status)) throw fail('审核状态无效');
    if (status === 'rejected' && target.status !== 'pending') throw fail('只能拒绝待审核的注册申请');
    transaction(() => {
      stmt('UPDATE accounts SET status=?,reviewed_by=?,reviewed_at=?,updated_at=? WHERE user_id=?').run(status, actor.id, Date.now(), Date.now(), target.id);
      if (status !== 'approved') stmt('DELETE FROM sessions WHERE user_id=?').run(target.id);
      if (status === 'approved') stmt('DELETE FROM removed_users WHERE user_id=?').run(target.id);
      audit(actor.id, target.id, { approved: 'approve', rejected: 'reject', suspended: 'suspend' }[status], target.status);
    });
    closeUser(target.id);
    changed();
    res.json({ account: publicAccount(account(target.id)) });
  });
  app.post('/api/admin/role', (req, res) => {
    const actor = requireAdmin(req);
    if (actor.role !== 'super_admin') throw fail('只有超级管理员可以调整角色', 403);
    const target = managedAccount(req, actor);
    if (target.status !== 'approved' || !['user', 'admin'].includes(req.body?.role)) throw fail('只能调整已通过审核的用户角色');
    transaction(() => {
      stmt('UPDATE accounts SET role=?,updated_at=? WHERE user_id=?').run(req.body.role, Date.now(), target.id);
      audit(actor.id, target.id, 'role', `${target.role}->${req.body.role}`);
    });
    closeUser(target.id);
    changed();
    res.json({ account: publicAccount(account(target.id)) });
  });
  // 成员忘记密码时由管理员重置：生成一次性的临时密码，只返回这一次；对方用它登录后必须先改密码，原有登录全部失效。
  app.post('/api/admin/password', async (req, res) => {
    const actor = requireAdmin(req);
    const target = managedAccount(req, actor);
    if (!['approved', 'suspended'].includes(target.status)) throw fail('只能重置已通过审核的账号');
    rateLimit(req, 'admin-password', 10, 15 * 60000);
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
    const digits = '23456789';
    const pick = (chars, count) => [...randomBytes(count)].map(byte => chars[byte % chars.length]).join('');
    const password = `${pick(alphabet, 4)}-${pick(digits, 4)}-${pick(alphabet + digits, 4)}`;
    const encoded = await withHashSlot(() => passwordHash(password));
    transaction(() => {
      stmt('UPDATE accounts SET password_hash=?,must_change_password=1,updated_at=? WHERE user_id=?').run(encoded, Date.now(), target.id);
      stmt('DELETE FROM sessions WHERE user_id=?').run(target.id);
      audit(actor.id, target.id, 'reset-password');
    });
    closeUser(target.id);
    res.json({ password });
  });
  return { user, account: req => publicAccount(session(req)), activeId: id => active(account(id)), tokenHash: req => hash(token(req)),
    validSocket: socket => Boolean(stmt('SELECT 1 FROM sessions WHERE token_hash=? AND expires_at>?').get(socket.sessionHash, Date.now()) && active(account(socket.userId))),
    cleanup: () => stmt('DELETE FROM sessions WHERE expires_at<=?').run(Date.now()),
  };
}
