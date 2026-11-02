import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { send, startCloud } from './helpers.mjs';

describe('账号模式', () => {
  let space;
  before(async () => { space = await startCloud(); });
  after(() => space.close());

  test('邀请码、本机初始化和设备凭证入口全部关闭', async () => {
    const stranger = space.client();
    assert.notEqual((await stranger.post('/api/join', { inviteCode: 'ANYTHING', name: '路人' })).status, 201);
    assert.notEqual((await stranger.post('/api/setup', { name: '路人', spaceName: '抢先' })).status, 201);
    assert.notEqual((await stranger.post('/api/device', { device: 'a'.repeat(64) })).status, 200);
  });

  test('注册后待审核，审核前不能进入聊天', async () => {
    const pending = await space.register('待审核');
    assert.equal((await pending.get('/api/auth/me')).body.account.status, 'pending');
    assert.equal((await pending.get('/api/state')).status, 401);
    assert.notEqual((await send(pending, 'lobby', '偷偷发')).status, 201);
  });

  test('审核通过后可以收发消息', async () => {
    const alice = await space.member('Alice');
    const bob = await space.member('Bob');
    assert.equal((await send(alice, 'lobby', '你好')).status, 201);
    assert.ok((await bob.get('/api/messages?roomId=lobby')).body.messages.some(message => message.text === '你好'));
  });

  test('普通成员不能审核或调整角色', async () => {
    const alice = await space.member('普通成员');
    const target = await space.register('目标');
    assert.equal((await alice.post('/api/admin/review', { userId: target.id, status: 'approved' })).status, 403);
    assert.equal((await alice.post('/api/admin/role', { userId: target.id, role: 'admin' })).status, 403);
  });

  test('停用后立即失去访问权限', async () => {
    const member = await space.member('将被停用');
    assert.equal((await member.get('/api/state')).status, 200);
    assert.equal((await space.admin.post('/api/admin/review', { userId: member.id, status: 'suspended' })).status, 200);
    assert.equal((await member.get('/api/state')).status, 401);
  });
});
