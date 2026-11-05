import assert from 'node:assert/strict';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, test } from 'node:test';
import { listen, send, settle, startLocal } from './helpers.mjs';

describe('按会话自动删除', () => {
  let space, alice, bob, carol, group, direct;
  before(async () => {
    space = await startLocal({ scheduleInterval: 40 });
    alice = await space.join('Alice');
    bob = await space.join('Bob');
    carol = await space.join('Carol');
    group = (await alice.post('/api/rooms', { name: '阅后即焚', memberIds: [bob.id] })).body.id;
    direct = (await bob.post('/api/rooms', { userId: carol.id })).body.id;
  });
  after(() => space.close());

  test('群主、私聊双方、大厅管理者可以设置；其他人不行；只接受固定的几档', async () => {
    assert.equal((await bob.post('/api/room-auto-delete', { roomId: group, seconds: 86400 })).status, 403);
    assert.equal((await alice.post('/api/room-auto-delete', { roomId: group, seconds: 3600 })).status, 400);
    assert.equal((await alice.post('/api/room-auto-delete', { roomId: group, seconds: 604800 })).status, 200);
    assert.equal((await bob.get('/api/state')).body.rooms.find(room => room.id === group).autoDelete, 604800);
    assert.equal((await carol.post('/api/room-auto-delete', { roomId: direct, seconds: 86400 })).status, 200);
    assert.equal((await alice.post('/api/room-auto-delete', { roomId: direct, seconds: 0 })).status, 403);
    assert.equal((await alice.post('/api/room-auto-delete', { roomId: 'lobby', seconds: 86400 })).status, 403);
    assert.equal((await space.owner.post('/api/room-auto-delete', { roomId: 'lobby', seconds: 0 })).status, 200);
    assert.equal((await alice.post('/api/room-auto-delete', { roomId: group, seconds: 0 })).status, 200);
    assert.equal((await bob.get('/api/state')).body.rooms.find(room => room.id === group).autoDelete, 0);
  });

  test('超过时长的消息为所有人删除，成员实时收到；新消息和其他会话不受影响', async () => {
    const old = [(await send(alice, group, '两天前的消息')).body.message, (await send(bob, group, '也是两天前')).body.message];
    const fresh = (await send(alice, group, '刚发的')).body.message;
    const elsewhere = (await send(alice, 'lobby', '大厅里的旧消息')).body.message;
    const db = new DatabaseSync(path.join(space.dataDir, 'chat.sqlite'));
    const aged = db.prepare('UPDATE messages SET created_at=created_at-? WHERE id=?');
    for (const message of [...old, elsewhere]) aged.run(2 * 86400000, message.id);
    db.close();
    const live = await listen(space.base, bob);
    await alice.post('/api/room-auto-delete', { roomId: group, seconds: 86400 });
    await settle(400);
    const deleted = live.events.find(event => event.type === 'messages-deleted');
    live.close();
    assert.equal(deleted.roomId, group);
    assert.deepEqual(deleted.ids.sort(), old.map(message => message.id).sort());
    const remaining = (await bob.get(`/api/messages?roomId=${group}`)).body.messages.map(message => message.id);
    assert.deepEqual(remaining, [fresh.id]);
    assert.ok((await alice.get('/api/messages?roomId=lobby')).body.messages.some(message => message.id === elsewhere.id));
  });
});
