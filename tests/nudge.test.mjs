import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { listen, settle, startLocal } from './helpers.mjs';

describe('拍一拍', () => {
  let space, alice, bob, carol, group;
  before(async () => {
    space = await startLocal();
    alice = await space.join('Alice');
    bob = await space.join('Bob');
    carol = await space.join('Carol');
    group = (await alice.post('/api/rooms', { name: '拍一拍', memberIds: [bob.id] })).body.id;
  });
  after(() => space.close());

  test('拍会话里的人：成员实时收到一条带 nudge 的消息，也能拍自己', async () => {
    const live = await listen(space.base, bob);
    const nudged = await alice.post('/api/nudge', { roomId: group, userId: bob.id });
    assert.equal(nudged.status, 201);
    assert.deepEqual(nudged.body.message.nudge, { targetId: bob.id });
    assert.equal(nudged.body.message.text, '');
    await settle();
    assert.equal(live.events.find(event => event.type === 'message').message.nudge.targetId, bob.id);
    live.close();
    assert.equal((await alice.post('/api/nudge', { roomId: group, userId: alice.id })).status, 201);
    const history = (await bob.get(`/api/messages?roomId=${group}`)).body.messages;
    assert.equal(history.filter(message => message.nudge).length, 2);
  });

  test('不能拍会话外的人，外人不能拍；不能转发、编辑，可以撤回', async () => {
    assert.equal((await alice.post('/api/nudge', { roomId: group, userId: carol.id })).status, 400);
    assert.equal((await carol.post('/api/nudge', { roomId: group, userId: alice.id })).status, 403);
    const message = (await alice.post('/api/nudge', { roomId: group, userId: bob.id })).body.message;
    assert.equal((await alice.post('/api/forward', { roomId: 'lobby', messageIds: [message.id] })).status, 400);
    assert.equal((await alice.post('/api/edit-message', { messageId: message.id, text: '补上正文' })).status, 400);
    assert.equal((await alice.post('/api/recall-message', { messageId: message.id })).status, 200);
    const recalled = (await bob.get(`/api/messages?roomId=${group}`)).body.messages.find(item => item.id === message.id);
    assert.ok(recalled.recalledAt);
    assert.equal(recalled.nudge, null);
  });

  test('每人每分钟最多拍 10 次', async () => {
    const dave = await space.join('Dave');
    const results = [];
    for (let index = 0; index < 11; index++) results.push((await dave.post('/api/nudge', { roomId: 'lobby', userId: alice.id })).status);
    assert.equal(results.filter(status => status === 201).length, 10);
    assert.equal(results.at(-1), 429);
  });
});
