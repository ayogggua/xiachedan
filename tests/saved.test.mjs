import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { send, startLocal } from './helpers.mjs';

describe('收藏', () => {
  let space, alice, bob, carol, group;
  before(async () => {
    space = await startLocal();
    alice = await space.join('Alice');
    bob = await space.join('Bob');
    carol = await space.join('Carol');
    group = (await alice.post('/api/rooms', { name: '小组', memberIds: [bob.id, carol.id] })).body.id;
  });
  after(() => space.close());

  test('收藏只属于自己，最近收藏的在前，可以取消', async () => {
    const first = (await send(alice, 'lobby', '会议纪要')).body.message;
    const second = (await send(alice, group, '服务器密码在保险柜')).body.message;
    await bob.post('/api/saved', { messageId: first.id });
    await bob.post('/api/saved', { messageId: second.id });
    assert.deepEqual((await bob.get('/api/saved')).body.items.map(item => item.message.text), ['服务器密码在保险柜', '会议纪要']);
    assert.equal((await carol.get('/api/saved')).body.items.length, 0);
    await bob.post('/api/saved', { messageId: first.id, saved: false });
    assert.deepEqual((await bob.get('/api/saved')).body.items.map(item => item.message.text), ['服务器密码在保险柜']);
  });

  test('退群后收藏里不再显示那个群的消息；撤回的也不显示', async () => {
    await bob.post('/api/room-leave', { roomId: group });
    assert.equal((await bob.get('/api/saved')).body.items.length, 0);
    const message = (await send(alice, 'lobby', '临时通知')).body.message;
    await carol.post('/api/saved', { messageId: message.id });
    await alice.post('/api/recall-message', { messageId: message.id });
    assert.equal((await carol.get('/api/saved')).body.items.length, 0);
  });

  test('不能收藏无权访问的消息', async () => {
    const secret = (await send(alice, group, '群内消息')).body.message;
    assert.equal((await bob.post('/api/saved', { messageId: secret.id })).status, 403);
    assert.equal((await bob.post('/api/saved', { messageId: 'missing' })).status, 404);
  });
});
