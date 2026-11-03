import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { startLocal } from './helpers.mjs';

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000' + '1f15c4890000000d49444154789c6360000002000154a24f5f0000000049454e44ae426082', 'hex');
const cookie = member => [...member.jar].map(([key, value]) => `${key}=${value}`).join('; ');
async function avatar(space, member, roomId, bytes = PNG) {
  const form = new FormData();
  form.append('file', new Blob([bytes]), 'avatar.png');
  const response = await fetch(`${space.base}/api/uploads?purpose=room-avatar&roomId=${roomId}`, { method: 'POST', headers: { 'X-Linliao': '1', cookie: cookie(member) }, body: form });
  return { status: response.status, body: await response.json() };
}

describe('群头像', () => {
  let space, alice, bob, carol, group, direct;
  before(async () => {
    space = await startLocal();
    alice = await space.join('Alice');
    bob = await space.join('Bob');
    carol = await space.join('Carol');
    group = (await alice.post('/api/rooms', { name: '设计组', memberIds: [bob.id] })).body.id;
    direct = (await alice.post('/api/rooms', { userId: bob.id })).body.id;
  });
  after(() => space.close());

  test('群主换头像，成员看到并能加载图片，外人取不到', async () => {
    const result = await avatar(space, alice, group);
    assert.equal(result.status, 201);
    const room = (await bob.get('/api/state')).body.rooms.find(item => item.id === group);
    assert.equal(room.avatar, result.body.avatar);
    const id = result.body.avatar.slice(7);
    assert.equal((await fetch(`${space.base}/api/media?id=${id}`, { headers: { cookie: cookie(bob) } })).status, 200);
    assert.equal((await fetch(`${space.base}/api/media?id=${id}`, { headers: { cookie: cookie(carol) } })).status, 403);
  });

  test('普通成员、私聊、非图片都不行；可以移除', async () => {
    assert.equal((await avatar(space, bob, group)).status, 403);
    assert.equal((await avatar(space, alice, direct)).status, 403);
    assert.equal((await avatar(space, alice, group, Buffer.from('%PDF-1.7'))).status, 400);
    assert.equal((await alice.post('/api/room-avatar/remove', { roomId: group })).status, 200);
    assert.equal((await bob.get('/api/state')).body.rooms.find(item => item.id === group).avatar, null);
  });

  test('大厅由空间创建者换头像', async () => {
    assert.equal((await avatar(space, alice, 'lobby')).status, 403);
    assert.equal((await avatar(space, space.owner, 'lobby')).status, 201);
  });
});
