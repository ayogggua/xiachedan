import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { listen, send, settle, startLocal } from './helpers.mjs';

describe('会话内置顶消息', () => {
  let space, alice, bob, carol, group, direct;
  before(async () => {
    space = await startLocal();
    alice = await space.join('Alice');
    bob = await space.join('Bob');
    carol = await space.join('Carol');
    group = (await alice.post('/api/rooms', { name: '项目组', memberIds: [bob.id] })).body.id;
    direct = (await alice.post('/api/rooms', { userId: bob.id })).body.id;
  });
  after(() => space.close());

  test('群主置顶，群成员看到并实时收到通知；取消后消失', async () => {
    const message = (await send(bob, group, '周会改到周三')).body.message;
    const live = await listen(space.base, bob);
    const pinned = await alice.post('/api/room-pins', { roomId: group, messageId: message.id });
    assert.equal(pinned.status, 200);
    await settle();
    assert.ok(live.received('room-pins'));
    live.close();
    const view = (await bob.get(`/api/room-pins?roomId=${group}`)).body;
    assert.equal(view.pins[0].message.text, '周会改到周三');
    assert.equal(view.canPin, false);
    await alice.post('/api/room-pins', { roomId: group, messageId: message.id, pinned: false });
    assert.equal((await bob.get(`/api/room-pins?roomId=${group}`)).body.pins.length, 0);
  });

  test('普通成员不能在群里置顶；私聊双方都可以；外人看不到', async () => {
    const message = (await send(alice, group, '群消息')).body.message;
    assert.equal((await bob.post('/api/room-pins', { roomId: group, messageId: message.id })).status, 403);
    const secret = (await send(alice, direct, '地址')).body.message;
    assert.equal((await bob.post('/api/room-pins', { roomId: direct, messageId: secret.id })).status, 200);
    assert.equal((await carol.get(`/api/room-pins?roomId=${direct}`)).status, 403);
    assert.equal((await alice.post('/api/room-pins', { roomId: group, messageId: secret.id })).status, 404);
  });

  test('撤回后置顶自动取消；大厅由空间创建者置顶', async () => {
    const message = (await send(alice, 'lobby', '大厅公告')).body.message;
    assert.equal((await alice.post('/api/room-pins', { roomId: 'lobby', messageId: message.id })).status, 403);
    assert.equal((await space.owner.post('/api/room-pins', { roomId: 'lobby', messageId: message.id })).status, 200);
    await alice.post('/api/recall-message', { messageId: message.id });
    assert.equal((await alice.get('/api/room-pins?roomId=lobby')).body.pins.length, 0);
  });
});
