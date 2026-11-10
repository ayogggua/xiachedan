// 测试辅助：在临时数据目录、随机端口上启动真实服务，并提供带 Cookie 的请求客户端。
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startServer } from '../server/index.js';

export function client(base) {
  const jar = new Map();
  async function call(method, url, body, headers = {}) {
    const cookie = [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
    const response = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Linliao': '1', ...(cookie ? { cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const line of response.headers.getSetCookie()) {
      const pair = line.split(';')[0];
      const name = pair.slice(0, pair.indexOf('=')), value = pair.slice(pair.indexOf('=') + 1);
      if (value && !/Expires=Thu, 01 Jan 1970/i.test(line)) jar.set(name, value); else jar.delete(name);
    }
    const text = await response.text();
    let json;
    try { json = JSON.parse(text); } catch { json = text; }
    return { status: response.status, body: json };
  }
  return {
    jar,
    get: (url, headers) => call('GET', url, undefined, headers),
    post: (url, body = {}, headers) => call('POST', url, body, headers),
  };
}

async function start(options) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'xiachedan-test-'));
  const server = await startServer({ dataDir, port: 0, host: '127.0.0.1', serveWeb: false, ...options });
  return { server, dataDir, base: server.address,
    close: async () => { await server.close(); rmSync(dataDir, { recursive: true, force: true }); } };
}

// 局域网模式：创建空间的人（owner）已登录；join(name) 用邀请码加入一位新成员。
export async function startLocal({ setup = true, ...options } = {}) {
  const context = await start({ mode: 'local', ...options });
  const setupKey = new URL(context.server.setupUrl).hash.replace('#setup=', '');
  const owner = client(context.base);
  context.setupKey = setupKey;
  context.owner = owner;
  context.client = () => client(context.base);
  if (!setup) return context;
  const created = await owner.post('/api/setup', { name: '空间主人', spaceName: '测试空间', avatar: 'cat' }, { 'X-Setup-Key': setupKey });
  if (created.status !== 201) throw new Error(`setup failed: ${created.status}`);
  context.ownerId = created.body.me.id;
  const invite = await owner.get('/api/invite');
  context.inviteCode = invite.body.code;
  context.join = async (name, avatar = 'bird') => {
    const member = client(context.base);
    const joined = await member.post('/api/join', { inviteCode: context.inviteCode, name, avatar });
    if (joined.status !== 201) throw new Error(`join failed: ${joined.status} ${JSON.stringify(joined.body)}`);
    member.id = joined.body.me.id;
    return member;
  };
  return context;
}

export const ADMIN_PHONE = '19977167586';
export const ADMIN_PASSWORD = 'Admin-pass-2026';

// 账号模式：管理员已改过初始密码并登录；member(name) 注册并审核通过一位新成员。
export async function startCloud(options = {}) {
  process.env.CHAT_ADMIN_INITIAL_PASSWORD = 'Initial-pass-2026';
  const context = await start({ mode: 'cloud', ...options });
  const admin = client(context.base);
  await admin.post('/api/auth/login', { identifier: ADMIN_PHONE, password: 'Initial-pass-2026' });
  const changed = await admin.post('/api/auth/password', { currentPassword: 'Initial-pass-2026', password: ADMIN_PASSWORD });
  if (changed.status !== 200) throw new Error(`admin password change failed: ${changed.status}`);
  admin.id = changed.body.account.id;
  context.admin = admin;
  context.client = () => client(context.base);
  let count = 0;
  context.register = async (name) => {
    const member = client(context.base);
    const registered = await member.post('/api/auth/register', { identifier: `member${++count}@example.com`, password: 'Member-pass-2026', name });
    if (registered.status !== 201) throw new Error(`register failed: ${registered.status} ${JSON.stringify(registered.body)}`);
    member.id = registered.body.account.id;
    return member;
  };
  context.member = async (name) => {
    const member = await context.register(name);
    const approved = await admin.post('/api/admin/review', { userId: member.id, status: 'approved' });
    if (approved.status !== 200) throw new Error(`approve failed: ${approved.status}`);
    return member;
  };
  return context;
}

export const send = (member, roomId, text, extra = {}) =>
  member.post('/api/messages', { roomId, clientId: `c-${Date.now()}-${Math.random()}`, text, ...extra });

// 以成员身份连上实时通道，记录收到的事件；ready 之后才返回，避免漏掉后续事件。
export async function listen(base, member) {
  const { WebSocket } = await import('ws');
  const cookie = [...member.jar].map(([name, value]) => `${name}=${value}`).join('; ');
  const socket = new WebSocket(base.replace(/^http/, 'ws') + '/socket', { headers: { cookie } });
  const events = [];
  socket.on('message', data => events.push(JSON.parse(data)));
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.on('message', data => { if (JSON.parse(data).type === 'ready') resolve(); }); });
  return {
    events,
    received: type => events.some(event => event.type === type),
    clear: () => { events.length = 0; },
    send: event => socket.send(JSON.stringify(event)),
    close: () => socket.close(),
  };
}

export const settle = (ms = 150) => new Promise(resolve => setTimeout(resolve, ms));
