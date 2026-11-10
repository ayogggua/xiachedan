import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { listen, settle, startCloud, startLocal } from './helpers.mjs';

describe('推荐名片', () => {
  let space, alice, bob, carol, group;
  before(async () => {
    space = await startLocal();
    alice = await space.join('Alice');
    bob = await space.join('Bob');
    carol = await space.join('Carol');
    group = (await alice.post('/api/rooms', { name: '项目组', memberIds: [bob.id] })).body.id;
  });
  after(() => space.close());

  test('把 Carol 的名片发到群里：成员实时收到，预览和导出里是「名片」', async () => {
    const live = await listen(space.base, bob);
    const sent = await alice.post('/api/contact-card', { roomId: group, userId: carol.id });
    assert.equal(sent.status, 201);
    assert.deepEqual(sent.body.message.card, { userId: carol.id });
    await settle();
    assert.deepEqual(live.events.find(event => event.type === 'message').message.card, { userId: carol.id });
    live.close();
    const state = (await bob.get('/api/state')).body;
    assert.deepEqual(state.rooms.find(room => room.id === group).lastMessage.card, { userId: carol.id });
    assert.match((await alice.get(`/api/export?roomId=${group}&tz=0`)).body, /\[名片\] Carol/);
  });

  test('名片不能编辑、不能转发；撤回后名片信息一起去掉', async () => {
    const card = (await alice.post('/api/contact-card', { roomId: group, userId: carol.id })).body.message;
    assert.equal((await alice.post('/api/edit-message', { messageId: card.id, text: '改' })).status, 400);
    assert.equal((await alice.post('/api/forward', { roomId: 'lobby', messageIds: [card.id] })).status, 400);
    await alice.post('/api/recall-message', { messageId: card.id });
    const recalled = (await alice.get(`/api/messages?roomId=${group}`)).body.messages.find(message => message.id === card.id);
    assert.equal(recalled.card, null);
  });

  test('外人不能往会话里发，推荐不存在的人时拒绝，禁言时不能发', async () => {
    assert.equal((await carol.post('/api/contact-card', { roomId: group, userId: bob.id })).status, 403);
    assert.equal((await alice.post('/api/contact-card', { roomId: group, userId: 'nobody' })).status, 404);
    await space.owner.post('/api/admin/mute', { userId: alice.id, minutes: 10 });
    assert.equal((await alice.post('/api/contact-card', { roomId: group, userId: carol.id })).status, 403);
  });
});

describe('推荐名片（账号模式）', () => {
  let space;
  before(async () => { space = await startCloud(); });
  after(() => space.close());
  test('账号模式同样可以推荐', async () => {
    const alice = await space.member('Alice');
    const bob = await space.member('Bob');
    const sent = await alice.post('/api/contact-card', { roomId: 'lobby', userId: bob.id });
    assert.equal(sent.status, 201);
    assert.deepEqual(sent.body.message.card, { userId: bob.id });
  });
});
