import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { client, listen, settle, startCloud, startLocal } from './helpers.mjs';

describe('登录设备管理', () => {
  let space;
  before(async () => { space = await startCloud(); });
  after(() => space.close());

  async function login(agent) {
    const device = client(space.base);
    await device.post('/api/auth/login', { identifier: 'alice@example.com', password: 'Member-pass-2026' }, { 'User-Agent': agent });
    await device.get('/api/state', { 'User-Agent': agent });
    return device;
  }

  test('列出自己的登录设备，标出当前设备', async () => {
    const first = space.client();
    const registered = await first.post('/api/auth/register', { identifier: 'alice@example.com', password: 'Member-pass-2026', name: 'Alice' });
    await space.admin.post('/api/admin/review', { userId: registered.body.account.id, status: 'approved' });
    const mac = await login('Mozilla/5.0 (Macintosh) AppleWebKit Safari');
    await login('Mozilla/5.0 (Windows NT 10.0) Chrome/130');
    const list = (await mac.get('/api/sessions')).body.sessions;
    assert.equal(list.length, 3);
    assert.equal(list.filter(item => item.current).length, 1);
    assert.match(list.find(item => item.current).userAgent, /Macintosh/);
    assert.ok(list.some(item => /Windows/.test(item.userAgent)));
    assert.equal((await space.admin.get('/api/sessions')).body.sessions.some(item => /Windows/.test(item.userAgent)), false);
  });

  test('让某个设备下线：它的请求和实时连接立即失效，当前设备不受影响', async () => {
    const mac = await login('Mac Device');
    const windows = await login('Windows Device');
    const live = await listen(space.base, windows);
    const target = (await mac.get('/api/sessions')).body.sessions.find(item => item.userAgent === 'Windows Device');
    assert.equal((await mac.post('/api/sessions/revoke', { id: target.id })).status, 200);
    assert.equal((await windows.get('/api/state')).status, 401);
    assert.equal((await mac.get('/api/state')).status, 200);
    await settle();
    live.close();
  });

  test('不能让当前设备、别人的设备或不存在的设备下线', async () => {
    const mac = await login('Mac Device');
    const current = (await mac.get('/api/sessions')).body.sessions.find(item => item.current);
    assert.equal((await mac.post('/api/sessions/revoke', { id: current.id })).status, 404);
    const adminSession = (await space.admin.get('/api/sessions')).body.sessions[0];
    assert.equal((await mac.post('/api/sessions/revoke', { id: adminSession.id })).status, 404);
    assert.equal((await space.admin.get('/api/state')).status, 200);
    assert.equal((await mac.post('/api/sessions/revoke', { id: 'abc' })).status, 404);
  });

  test('退出其他所有设备', async () => {
    const mac = await login('Mac Device');
    const other = await login('Other Device');
    const result = await mac.post('/api/sessions/revoke', { others: true });
    assert.ok(result.body.revoked >= 1);
    assert.equal((await other.get('/api/state')).status, 401);
    assert.equal((await mac.get('/api/sessions')).body.sessions.length, 1);
  });
});

describe('局域网模式', () => {
  let space;
  before(async () => { space = await startLocal(); });
  after(() => space.close());

  test('没有登录设备管理', async () => {
    assert.equal((await space.owner.get('/api/sessions')).status, 403);
  });
});
