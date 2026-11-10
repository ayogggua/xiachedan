import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { listen, send, settle, startCloud, startLocal } from './helpers.mjs';

const texts = response => response.body.messages.map(message => message.text);

describe('只对自己删除消息、清空会话', () => {
  let space, alice, bob, carol, group;
  before(async () => {
    space = await startLocal();
    alice = await space.join('Alice');
    bob = await space.join('Bob');
    carol = await space.join('Carol');
    group = (await alice.post('/api/rooms', { name: '项目组', memberIds: [bob.id] })).body.id;
  });
  after(() => space.close());

  test('删除后自己的历史、搜索、未读、最后一条里都没有，别人照常能看到', async () => {
    await send(bob, group, '第一条 关键字');
    const second = (await send(bob, group, '第二条 关键字')).body.message;
    const live = await listen(space.base, alice);
    const hidden = await alice.post('/api/messages/hide', { messageIds: [second.id] });
    assert.equal(hidden.status, 200);
    await settle();
    assert.deepEqual(live.events.find(event => event.type === 'messages-hidden').messageIds, [second.id]);
    live.close();
    assert.deepEqual(texts(await alice.get(`/api/messages?roomId=${group}`)), ['第一条 关键字']);
    assert.deepEqual(texts(await alice.get(`/api/messages?roomId=${group}&after=0`)), ['第一条 关键字']);
    assert.deepEqual(texts(await alice.get(`/api/search?q=${encodeURIComponent('关键字')}`)), ['第一条 关键字']);
    assert.deepEqual(texts(await bob.get(`/api/messages?roomId=${group}`)), ['第一条 关键字', '第二条 关键字']);
    const state = (await alice.get('/api/state')).body;
    assert.equal(state.rooms.find(room => room.id === group).lastMessage.text, '第一条 关键字');
    const unread = (await alice.post('/api/unread-counts', { cursors: { [group]: 0 } })).body.rooms.find(room => room.id === group);
    assert.equal(unread.unreadCount, 1);
    assert.equal((await alice.get(`/api/message-location?id=${second.id}`)).status, 404);
    assert.equal((await bob.get(`/api/message-location?id=${second.id}`)).status, 200);
  });

  test('删掉的消息被编辑或回应时，不再推给自己', async () => {
    const message = (await send(bob, group, '会被编辑')).body.message;
    await alice.post('/api/messages/hide', { messageIds: [message.id] });
    const live = await listen(space.base, alice);
    const watcher = await listen(space.base, bob);
    await bob.post('/api/edit-message', { messageId: message.id, text: '已经改了' });
    await settle();
    assert.equal(live.received('message-edited'), false);
    assert.equal(watcher.received('message-edited'), true);
    live.close(); watcher.close();
  });

  test('清空会话只影响自己：之前的消息都不见了，之后的新消息照常', async () => {
    await send(bob, group, '清空前');
    const cleared = await alice.post('/api/room-clear', { roomId: group });
    assert.equal(cleared.status, 200);
    assert.deepEqual(texts(await alice.get(`/api/messages?roomId=${group}`)), []);
    assert.equal((await alice.get('/api/state')).body.cleared[group], cleared.body.throughSeq);
    assert.equal((await alice.get('/api/state')).body.rooms.find(room => room.id === group).lastMessage, null);
    await send(bob, group, '清空后');
    assert.deepEqual(texts(await alice.get(`/api/messages?roomId=${group}`)), ['清空后']);
    assert.ok(texts(await bob.get(`/api/messages?roomId=${group}`)).includes('清空前'));
    const exported = await alice.get(`/api/export?roomId=${group}&tz=0`);
    assert.doesNotMatch(exported.body, /清空前/);
    assert.match(exported.body, /清空后/);
  });

  test('收藏和提醒随删除一起去掉；不能删除看不到的消息', async () => {
    const sent = await send(bob, group, '收藏过');
    assert.equal(sent.status, 201, JSON.stringify(sent.body));
    const message = sent.body.message;
    await alice.post('/api/saved', { messageId: message.id, saved: true });
    await alice.post('/api/messages/hide', { messageIds: [message.id] });
    assert.equal((await alice.get('/api/saved')).body.items.some(item => item.message.id === message.id), false);
    assert.equal((await alice.post('/api/saved', { messageId: message.id, saved: true })).status, 404);
    const secret = (await bob.post('/api/rooms', { name: '小群', memberIds: [alice.id] })).body.id;
    const other = (await send(bob, secret, '别人的群')).body.message;
    assert.equal((await carol.post('/api/messages/hide', { messageIds: [other.id] })).status, 404);
    assert.equal((await carol.post('/api/messages/hide', { messageIds: [] })).status, 400);
    assert.equal((await carol.post('/api/room-clear', { roomId: secret })).status, 403);
  });
});

describe('只对自己删除（账号模式）', () => {
  let space;
  before(async () => { space = await startCloud(); });
  after(() => space.close());

  test('账号模式下同样只影响自己', async () => {
    const alice = await space.member('Alice');
    const bob = await space.member('Bob');
    const message = (await send(bob, 'lobby', '大厅消息')).body.message;
    assert.equal((await alice.post('/api/messages/hide', { messageIds: [message.id] })).status, 200);
    assert.equal(texts(await alice.get('/api/messages?roomId=lobby')).includes('大厅消息'), false);
    assert.equal(texts(await bob.get('/api/messages?roomId=lobby')).includes('大厅消息'), true);
  });
});
