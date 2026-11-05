import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { startLocal } from './helpers.mjs';

describe('群昵称', () => {
  let space, alice, bob, carol, group;
  const nicknames = async member => (await member.get('/api/state')).body.rooms.find(room => room.id === group).nicknames;
  before(async () => {
    space = await startLocal();
    alice = await space.join('Alice');
    bob = await space.join('Bob');
    carol = await space.join('Carol');
    group = (await alice.post('/api/rooms', { name: '昵称', memberIds: [bob.id] })).body.id;
  });
  after(() => space.close());

  test('成员给自己设群昵称，群里所有人看到；清空恢复原名', async () => {
    assert.equal((await bob.post('/api/room-nickname', { roomId: group, nickname: '  后端小王 ' })).body.nickname, '后端小王');
    assert.deepEqual(await nicknames(alice), { [bob.id]: '后端小王' });
    await bob.post('/api/room-nickname', { roomId: group, nickname: '' });
    assert.deepEqual(await nicknames(alice), {});
  });

  test('只能在自己所在的群里设；不能超过 16 个字；私聊和大厅不能设；被移出后昵称清掉', async () => {
    assert.equal((await carol.post('/api/room-nickname', { roomId: group, nickname: '外人' })).status, 403);
    assert.equal((await bob.post('/api/room-nickname', { roomId: group, nickname: '长'.repeat(17) })).status, 400);
    assert.equal((await bob.post('/api/room-nickname', { roomId: 'lobby', nickname: '大厅' })).status, 400);
    await bob.post('/api/room-nickname', { roomId: group, nickname: '小王' });
    await alice.post('/api/room-remove', { roomId: group, userId: bob.id });
    await alice.post('/api/room-members', { roomId: group, memberIds: [bob.id] });
    assert.deepEqual(await nicknames(alice), {});
  });
});
