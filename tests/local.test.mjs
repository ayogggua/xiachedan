import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { send, startLocal } from './helpers.mjs';

describe('局域网模式：创建与加入', () => {
  test('只有带初始化密钥的本机请求才能创建空间', async () => {
    const space = await startLocal({ setup: false });
    try {
      const stranger = space.client();
      assert.equal((await stranger.get('/api/bootstrap')).body.canCreate, false);
      assert.equal((await stranger.post('/api/setup', { name: '路人', spaceName: '抢先' })).status, 403);
      assert.equal((await space.owner.get('/api/bootstrap', { 'X-Setup-Key': space.setupKey })).body.canCreate, true);
      const created = await space.owner.post('/api/setup', { name: '主人', spaceName: '空间' }, { 'X-Setup-Key': space.setupKey });
      assert.equal(created.status, 201);
      assert.equal((await space.owner.post('/api/setup', { name: '主人', spaceName: '空间' }, { 'X-Setup-Key': space.setupKey })).status, 409);
    } finally { await space.close(); }
  });

  test('邀请码错误不能加入，正确的邀请码创建新成员', async () => {
    const space = await startLocal();
    try {
      const stranger = space.client();
      assert.equal((await stranger.post('/api/join', { inviteCode: 'WRONGCODE000', name: '路人' })).status, 403);
      const member = await space.join('同事');
      const state = await member.get('/api/state');
      assert.equal(state.status, 200);
      assert.equal(state.body.me.name, '同事');
      assert.ok(state.body.users.some(user => user.id === space.ownerId));
    } finally { await space.close(); }
  });
});

describe('局域网模式：消息与权限', () => {
  let space, alice, bob, carol, direct;
  before(async () => {
    space = await startLocal();
    alice = await space.join('Alice');
    bob = await space.join('Bob');
    carol = await space.join('Carol');
    direct = (await alice.post('/api/rooms', { userId: bob.id })).body.id;
  });
  after(() => space.close());

  test('未加入的人不能读取任何会话', async () => {
    assert.equal((await space.client().get('/api/messages?roomId=lobby')).status, 401);
  });

  test('大厅消息所有成员可见，私聊只对双方可见', async () => {
    assert.equal((await send(alice, 'lobby', '大家好')).status, 201);
    assert.ok((await carol.get('/api/messages?roomId=lobby')).body.messages.some(message => message.text === '大家好'));
    assert.equal((await send(alice, direct, '悄悄话')).status, 201);
    assert.ok((await bob.get(`/api/messages?roomId=${direct}`)).body.messages.some(message => message.text === '悄悄话'));
    assert.equal((await carol.get(`/api/messages?roomId=${direct}`)).status, 403);
    assert.equal((await send(carol, direct, '插一嘴')).status, 403);
  });

  test('同一 clientId 重发不会产生重复消息', async () => {
    const body = { roomId: 'lobby', clientId: 'retry-1', text: '只发一次' };
    await alice.post('/api/messages', body);
    await alice.post('/api/messages', body);
    const messages = (await bob.get('/api/messages?roomId=lobby')).body.messages.filter(message => message.text === '只发一次');
    assert.equal(messages.length, 1);
  });

  test('只能撤回自己的消息，撤回后搜索不到', async () => {
    const message = (await send(alice, 'lobby', '撤回前的暗号')).body.message;
    assert.equal((await bob.get('/api/search?roomId=lobby&q=暗号')).body.messages.length, 1);
    assert.equal((await bob.post('/api/recall-message', { messageId: message.id })).status, 403);
    assert.equal((await alice.post('/api/recall-message', { messageId: message.id })).status, 200);
    assert.equal((await bob.get('/api/search?roomId=lobby&q=暗号')).body.messages.length, 0);
  });

  test('搜索不能越权查询私聊', async () => {
    assert.equal((await carol.get(`/api/search?roomId=${direct}&q=悄悄话`)).status, 403);
    assert.equal((await bob.get(`/api/search?roomId=${direct}&q=悄悄话`)).body.messages.length, 1);
  });

  test('非空间创建者不能移除成员', async () => {
    assert.equal((await alice.post('/api/remove-member', { userId: carol.id })).status, 403);
  });
});

describe('局域网模式：按电脑识别身份', () => {
  const deviceA = 'a'.repeat(64), deviceB = 'b'.repeat(64);
  let space, member, spaceId;
  before(async () => {
    space = await startLocal();
    member = await space.join('换电脑的人');
    spaceId = (await member.get('/api/bootstrap')).body.spaceId;
  });
  after(() => space.close());

  test('空间编号固定且格式正确', async () => {
    assert.match(spaceId, /^[0-9a-f]{32}$/);
    assert.equal((await space.client().get('/api/bootstrap')).body.spaceId, spaceId);
  });

  test('未绑定的电脑认不出身份，格式错误的凭证被拒绝', async () => {
    assert.equal((await space.client().post('/api/device', { device: deviceA })).status, 404);
    assert.equal((await space.client().post('/api/device', { device: 'xyz' })).status, 400);
  });

  test('绑定后会话丢失仍能认回原身份，旧会话失效', async () => {
    const bound = await member.post('/api/device', { device: deviceA });
    assert.equal(bound.status, 200);
    assert.equal(bound.body.switched, false);
    const oldCookie = new Map(member.jar);
    const fresh = space.client();
    const restored = await fresh.post('/api/device', { device: deviceA });
    assert.equal(restored.body.me.id, member.id);
    assert.equal(restored.body.switched, true);
    assert.equal((await fresh.get('/api/state')).body.me.id, member.id);
    member.jar.clear();
    for (const [name, value] of oldCookie) member.jar.set(name, value);
    assert.equal((await member.get('/api/state')).status, 401);
  });

  test('其他电脑的凭证不能冒用', async () => {
    assert.equal((await space.client().post('/api/device', { device: deviceB })).status, 404);
  });
});
