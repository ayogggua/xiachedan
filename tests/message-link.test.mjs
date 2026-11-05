import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { send, startCloud, startLocal } from './helpers.mjs';

describe('消息链接定位', () => {
  let space, alice, bob, carol, group;
  before(async () => {
    space = await startLocal();
    alice = await space.join('Alice');
    bob = await space.join('Bob');
    carol = await space.join('Carol');
    group = (await alice.post('/api/rooms', { name: '链接', memberIds: [bob.id] })).body.id;
  });
  after(() => space.close());

  test('会话成员能查到消息所在的会话和位置，话题回复带上根消息', async () => {
    const root = (await send(alice, group, '根消息')).body.message;
    const reply = (await send(bob, group, '话题回复', { threadOf: root.id })).body.message;
    const found = await bob.get(`/api/message-location?id=${root.id}`);
    assert.equal(found.status, 200);
    assert.deepEqual(found.body, { id: root.id, roomId: group, seq: root.seq, threadOf: null });
    assert.equal((await alice.get(`/api/message-location?id=${reply.id}`)).body.threadOf, root.id);
    const lobby = (await send(carol, 'lobby', '大厅里的消息')).body.message;
    assert.equal((await alice.get(`/api/message-location?id=${lobby.id}`)).body.roomId, 'lobby');
  });

  test('不在会话里、不存在、清空之后都返回 404', async () => {
    const secret = (await send(alice, group, '只有群成员能看')).body.message;
    const hidden = await carol.get(`/api/message-location?id=${secret.id}`);
    const missing = await carol.get('/api/message-location?id=missing');
    assert.equal(hidden.status, 404);
    assert.equal(missing.status, 404);
    assert.equal(hidden.body.error, missing.body.error);
    assert.equal((await carol.get('/api/message-location')).status, 404);
    await space.owner.post('/api/clear-history', { confirmation: '清空' });
    assert.equal((await alice.get(`/api/message-location?id=${secret.id}`)).status, 404);
  });
});

describe('账号模式的消息链接', () => {
  let space;
  before(async () => { space = await startCloud(); });
  after(() => space.close());

  test('已审核成员可以定位大厅消息', async () => {
    const alice = await space.member('Alice');
    const message = (await send(alice, 'lobby', '你好')).body.message;
    assert.equal((await alice.get(`/api/message-location?id=${message.id}`)).body.seq, message.seq);
  });
});
