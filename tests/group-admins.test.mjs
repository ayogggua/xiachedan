import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { startLocal } from './helpers.mjs';

describe('群管理员与移出成员', () => {
  let space, owner, admin, bob, carol, dave, group;
  const room = async member => (await member.get('/api/state')).body.rooms.find(item => item.id === group);
  before(async () => {
    space = await startLocal();
    owner = await space.join('Owner');
    admin = await space.join('Admin');
    bob = await space.join('Bob');
    carol = await space.join('Carol');
    dave = await space.join('Dave');
    group = (await owner.post('/api/rooms', { name: '管理', memberIds: [admin.id, bob.id, carol.id] })).body.id;
  });
  after(() => space.close());

  test('只有群主能设置管理员；管理员可以改群名和公告', async () => {
    assert.equal((await bob.post('/api/room-admins', { roomId: group, userId: admin.id, admin: true })).status, 403);
    assert.equal((await owner.post('/api/room-admins', { roomId: group, userId: dave.id, admin: true })).status, 400);
    const set = await owner.post('/api/room-admins', { roomId: group, userId: admin.id, admin: true });
    assert.deepEqual(set.body.adminIds, [admin.id]);
    assert.deepEqual((await bob.get('/api/state')).body.rooms.find(item => item.id === group).adminIds, [admin.id]);
    assert.equal((await admin.post('/api/room-settings', { roomId: group, announcement: '管理员发的公告' })).status, 200);
    assert.equal((await room(bob)).announcement.text, '管理员发的公告');
    assert.equal((await bob.post('/api/room-settings', { roomId: group, name: '偷改' })).status, 403);
    assert.equal((await admin.post('/api/room-admins', { roomId: group, userId: bob.id, admin: true })).status, 403);
    assert.equal((await admin.post('/api/room-owner', { roomId: group, userId: admin.id })).status, 403);
  });

  test('管理员能移出普通成员，不能移出群主和其他管理员；群主都能移出；普通成员不能移出别人', async () => {
    await owner.post('/api/room-admins', { roomId: group, userId: carol.id, admin: true });
    assert.equal((await bob.post('/api/room-remove', { roomId: group, userId: carol.id })).status, 403);
    assert.equal((await admin.post('/api/room-remove', { roomId: group, userId: owner.id })).status, 403);
    assert.equal((await admin.post('/api/room-remove', { roomId: group, userId: carol.id })).status, 403);
    assert.equal((await admin.post('/api/room-remove', { roomId: group, userId: bob.id })).status, 200);
    assert.equal((await bob.get(`/api/messages?roomId=${group}`)).status, 403);
    assert.equal((await owner.post('/api/room-remove', { roomId: group, userId: carol.id })).status, 200);
    assert.deepEqual((await room(owner)).adminIds, [admin.id]);
    assert.equal((await owner.post('/api/room-remove', { roomId: group, userId: owner.id })).status, 400);
  });

  test('转让群主后新群主不再算管理员；管理员退群后名单里没有他', async () => {
    await owner.post('/api/room-owner', { roomId: group, userId: admin.id });
    const after = await room(owner);
    assert.equal(after.ownerId, admin.id);
    assert.deepEqual(after.adminIds, []);
    await admin.post('/api/room-admins', { roomId: group, userId: owner.id, admin: true });
    await owner.post('/api/room-leave', { roomId: group });
    assert.deepEqual((await room(admin)).adminIds, []);
  });
});
