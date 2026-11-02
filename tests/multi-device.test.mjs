import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { send, startCloud, startLocal } from './helpers.mjs';

describe('局域网模式多设备登录', () => {
  let space, alice;
  before(async () => { space = await startLocal(); alice = await space.join('Alice'); });
  after(() => space.close());

  test('用登录码在新设备登录同一身份，两台设备同时可用', async () => {
    const { code, expiresAt } = (await alice.post('/api/login-code')).body;
    assert.match(code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    assert.ok(expiresAt > Date.now() + 9 * 60000);
    const phone = space.client();
    const redeemed = await phone.post('/api/login-code/redeem', { code: code.toLowerCase() });
    assert.equal(redeemed.status, 200);
    assert.equal(redeemed.body.me.id, alice.id);
    assert.equal((await phone.get('/api/state')).body.me.id, alice.id);
    assert.equal((await alice.get('/api/state')).status, 200);
    assert.equal((await send(phone, 'lobby', '手机上发的')).body.message.senderId, alice.id);
  });

  test('登录码只能用一次，新生成的会让旧的失效', async () => {
    const first = (await alice.post('/api/login-code')).body.code;
    const second = (await alice.post('/api/login-code')).body.code;
    assert.equal((await space.client().post('/api/login-code/redeem', { code: first })).status, 403);
    assert.equal((await space.client().post('/api/login-code/redeem', { code: second })).status, 200);
    assert.equal((await space.client().post('/api/login-code/redeem', { code: second })).status, 403);
  });

  test('退出只影响当前设备', async () => {
    const code = (await alice.post('/api/login-code')).body.code;
    const laptop = space.client();
    await laptop.post('/api/login-code/redeem', { code });
    assert.equal((await laptop.post('/api/logout')).status, 200);
    assert.equal((await laptop.get('/api/state')).status, 401);
    assert.equal((await alice.get('/api/state')).status, 200);
  });

  test('被移除的成员不能再用登录码，已有会话也失效', async () => {
    const bob = await space.join('Bob');
    const code = (await bob.post('/api/login-code')).body.code;
    const other = space.client();
    await other.post('/api/login-code/redeem', { code: (await bob.post('/api/login-code')).body.code });
    assert.equal((await space.owner.post('/api/remove-member', { userId: bob.id })).status, 200);
    assert.equal((await other.get('/api/state')).status, 401);
    assert.equal((await space.client().post('/api/login-code/redeem', { code })).status, 403);
  });

  test('未登录不能生成登录码', async () => {
    assert.equal((await space.client().post('/api/login-code')).status, 401);
  });
});

describe('登录码尝试次数限制', () => {
  test('同一来源连续错 12 次后暂时不能再试，正确的码也要等', async () => {
    const space = await startLocal();
    try {
      const alice = await space.join('Alice');
      const stranger = space.client();
      for (let i = 0; i < 12; i++) assert.equal((await stranger.post('/api/login-code/redeem', { code: 'AAAA-AAAA' })).status, 403);
      const code = (await alice.post('/api/login-code')).body.code;
      assert.equal((await stranger.post('/api/login-code/redeem', { code })).status, 429);
    } finally { await space.close(); }
  });
});

describe('账号模式不提供登录码', () => {
  let space;
  before(async () => { space = await startCloud(); });
  after(() => space.close());

  test('生成与兑换登录码都被拒绝', async () => {
    const member = await space.member('成员');
    assert.equal((await member.post('/api/login-code')).status, 403);
    assert.equal((await space.client().post('/api/login-code/redeem', { code: 'AAAA-AAAA' })).status, 403);
  });
});
