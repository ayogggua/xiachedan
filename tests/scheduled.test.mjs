import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { listen, send, settle, startLocal } from './helpers.mjs';

describe('定时消息与提醒', () => {
  let space, alice, bob, carol, group;
  before(async () => {
    space = await startLocal({ scheduleInterval: 50, scheduleMinLead: 0 });
    alice = await space.join('Alice');
    bob = await space.join('Bob');
    carol = await space.join('Carol');
    group = (await alice.post('/api/rooms', { name: '值班', memberIds: [bob.id] })).body.id;
  });
  after(() => space.close());

  test('到点以发送人身份发出，发出前只有自己看得到、可以取消', async () => {
    const live = await listen(space.base, bob);
    const created = await alice.post('/api/scheduled', { roomId: group, text: '记得交周报', sendAt: Date.now() + 300 });
    assert.equal(created.status, 201);
    assert.equal((await alice.get(`/api/scheduled?roomId=${group}`)).body.items.length, 1);
    assert.equal((await bob.get(`/api/scheduled?roomId=${group}`)).body.items.length, 0);
    const cancelled = (await alice.post('/api/scheduled', { roomId: group, text: '取消的这条', sendAt: Date.now() + 300 })).body.item;
    assert.equal((await alice.post('/api/scheduled/cancel', { id: cancelled.id })).status, 200);
    await settle(600);
    const texts = (await bob.get(`/api/messages?roomId=${group}`)).body.messages.map(message => message.text);
    assert.ok(texts.includes('记得交周报'));
    assert.ok(!texts.includes('取消的这条'));
    assert.ok(live.events.some(event => event.type === 'message' && event.message.senderId === alice.id));
    live.close();
    assert.equal((await alice.get(`/api/scheduled?roomId=${group}`)).body.items.length, 0);
  });

  test('时间不合理或无权访问会被拒绝；别人不能取消', async () => {
    assert.equal((await alice.post('/api/scheduled', { roomId: group, text: '太远', sendAt: Date.now() + 31 * 86400000 })).status, 400);
    assert.equal((await carol.post('/api/scheduled', { roomId: group, text: '外人', sendAt: Date.now() + 1000 })).status, 403);
    const item = (await alice.post('/api/scheduled', { roomId: group, text: '我的', sendAt: Date.now() + 60000 })).body.item;
    assert.equal((await bob.post('/api/scheduled/cancel', { id: item.id })).status, 404);
  });

  test('提醒只推给设置的人自己', async () => {
    const message = (await send(bob, group, '下午三点评审')).body.message;
    const mine = await listen(space.base, alice);
    const other = await listen(space.base, bob);
    assert.equal((await alice.post('/api/reminders', { messageId: message.id, remindAt: Date.now() + 200 })).status, 201);
    await settle(500);
    assert.equal(mine.events.find(event => event.type === 'reminder')?.message.text, '下午三点评审');
    assert.ok(!other.received('reminder'));
    mine.close(); other.close();
    assert.equal((await carol.post('/api/reminders', { messageId: message.id, remindAt: Date.now() + 1000 })).status, 403);
  });
});
