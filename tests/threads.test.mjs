import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { listen, send, settle, startLocal } from './helpers.mjs';

describe('话题回复', () => {
  let space, alice, bob, carol, group, root;
  before(async () => {
    space = await startLocal();
    alice = await space.join('Alice');
    bob = await space.join('Bob');
    carol = await space.join('Carol');
    group = (await alice.post('/api/rooms', { name: '研发', memberIds: [bob.id] })).body.id;
    root = (await send(alice, group, '这周的发布计划讨论这里')).body.message;
  });
  after(() => space.close());

  test('话题里的回复不进主时间线，根消息显示回复数，成员实时收到', async () => {
    const live = await listen(space.base, alice);
    const reply = await send(bob, group, '我负责后端', { threadOf: root.id });
    assert.equal(reply.status, 201);
    assert.equal(reply.body.message.threadOf, root.id);
    await settle();
    assert.equal(live.events.find(event => event.type === 'message-thread').thread.count, 1);
    live.close();
    const main = (await alice.get(`/api/messages?roomId=${group}`)).body.messages;
    assert.deepEqual(main.map(message => message.text), ['这周的发布计划讨论这里']);
    assert.equal(main[0].thread.count, 1);
    assert.deepEqual(main[0].thread.participants, [bob.id]);
    const thread = (await alice.get(`/api/thread?rootId=${root.id}`)).body;
    assert.deepEqual(thread.replies.map(message => message.text), ['我负责后端']);
  });

  test('话题回复不计入会话未读，也不改变侧栏最后一条', async () => {
    const before = (await alice.post('/api/unread-counts', { cursors: { [group]: root.seq } })).body.rooms.find(room => room.id === group);
    assert.equal(before.unreadCount, 0);
    const state = (await alice.get('/api/state')).body.rooms.find(room => room.id === group);
    assert.equal(state.lastMessage.id, root.id);
  });

  test('撤回话题回复后回复数减少；话题里不能再开话题；外人看不到', async () => {
    const reply = (await send(alice, group, '临时补充', { threadOf: root.id })).body.message;
    await alice.post('/api/recall-message', { messageId: reply.id });
    assert.equal((await bob.get(`/api/messages?roomId=${group}`)).body.messages[0].thread.count, 1);
    assert.equal((await send(bob, group, '套娃', { threadOf: reply.id })).status, 400);
    assert.equal((await carol.get(`/api/thread?rootId=${root.id}`)).status, 403);
    const lobby = (await send(alice, 'lobby', '大厅消息')).body.message;
    assert.equal((await send(bob, group, '跨会话', { threadOf: lobby.id })).status, 400);
  });
});
