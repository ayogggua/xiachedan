import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { listen, send, settle, startCloud, startLocal } from './helpers.mjs';

const roomOf = async (member, id) => (await member.get('/api/state')).body.rooms.find(room => room.id === id);

describe('群管理', () => {
  let space, alice, bob, carol, dave;
  const group = async (owner, others, name = '项目组') => (await owner.post('/api/rooms', { name, memberIds: others.map(member => member.id) })).body.id;
  before(async () => {
    space = await startLocal();
    alice = await space.join('Alice'); bob = await space.join('Bob'); carol = await space.join('Carol'); dave = await space.join('Dave');
  });
  after(() => space.close());

  test('创建者是群主，群主可以改名和写公告，普通成员不行', async () => {
    const id = await group(alice, [bob, carol]);
    assert.equal((await roomOf(bob, id)).ownerId, alice.id);
    assert.equal((await alice.post('/api/room-settings', { roomId: id, name: '发版小组' })).status, 200);
    assert.equal((await roomOf(carol, id)).name, '发版小组');
    assert.equal((await bob.post('/api/room-settings', { roomId: id, name: '改不了' })).status, 403);
    assert.equal((await alice.post('/api/room-settings', { roomId: id, announcement: '  周五 18:00 发版，请提前合并  ' })).status, 200);
    const announcement = (await roomOf(bob, id)).announcement;
    assert.equal(announcement.text, '周五 18:00 发版，请提前合并');
    assert.equal(announcement.updatedBy, alice.id);
    await alice.post('/api/room-settings', { roomId: id, announcement: '' });
    assert.equal((await roomOf(bob, id)).announcement, null);
  });

  test('参数校验：空群名、超长公告、非群聊、会话外的人', async () => {
    const id = await group(alice, [bob]);
    assert.equal((await alice.post('/api/room-settings', { roomId: id, name: '   ' })).status, 400);
    assert.equal((await alice.post('/api/room-settings', { roomId: id, announcement: '字'.repeat(501) })).status, 400);
    assert.equal((await alice.post('/api/room-settings', { roomId: id })).status, 400);
    assert.equal((await alice.post('/api/room-settings', { roomId: 'lobby', name: '大厅改名' })).status, 400);
    assert.equal((await carol.post('/api/room-settings', { roomId: id, name: '外人' })).status, 403);
  });

  test('群主可以转让给群里的成员，转让后失去管理权限', async () => {
    const id = await group(alice, [bob, carol]);
    assert.equal((await alice.post('/api/room-owner', { roomId: id, userId: dave.id })).status, 400);
    assert.equal((await bob.post('/api/room-owner', { roomId: id, userId: carol.id })).status, 403);
    assert.equal((await alice.post('/api/room-owner', { roomId: id, userId: bob.id })).status, 200);
    assert.equal((await roomOf(carol, id)).ownerId, bob.id);
    assert.equal((await alice.post('/api/room-settings', { roomId: id, name: '旧群主' })).status, 403);
    assert.equal((await bob.post('/api/room-settings', { roomId: id, name: '新群主' })).status, 200);
  });

  test('退出群聊后看不到也发不了消息；群主退出由最早的成员接任', async () => {
    const id = await group(alice, [bob, carol]);
    assert.equal((await bob.post('/api/room-leave', { roomId: id })).status, 200);
    assert.equal(await roomOf(bob, id), undefined);
    assert.equal((await send(bob, id, '还在吗')).status, 403);
    assert.equal((await alice.post('/api/room-leave', { roomId: id })).status, 200);
    assert.equal((await roomOf(carol, id)).ownerId, carol.id);
    assert.deepEqual((await roomOf(carol, id)).members, [carol.id]);
    assert.equal((await carol.post('/api/room-leave', { roomId: id })).status, 200);
    assert.equal(await roomOf(carol, id), undefined);
    assert.equal((await bob.post('/api/room-leave', { roomId: 'lobby' })).status, 400);
  });

  test('旧数据没有群主记录时，由成员列表里第一位当群主', async () => {
    const id = await group(alice, [bob]);
    const db = new DatabaseSync(path.join(space.dataDir, 'chat.sqlite'));
    db.prepare('DELETE FROM room_settings WHERE room_id=?').run(id);
    db.close();
    assert.equal((await roomOf(bob, id)).ownerId, alice.id);
    assert.equal((await alice.post('/api/room-settings', { roomId: id, announcement: '补上公告' })).status, 200);
  });

  test('群设置变化实时通知群成员，退出的人也会刷新', async () => {
    const id = await group(alice, [bob]);
    const member = await listen(space.base, bob), outsider = await listen(space.base, carol);
    await settle(); member.clear(); outsider.clear();
    await alice.post('/api/room-settings', { roomId: id, announcement: '新公告' });
    await settle();
    assert.ok(member.received('rooms'));
    assert.ok(!outsider.received('rooms'));
    member.clear();
    await bob.post('/api/room-leave', { roomId: id });
    await settle();
    assert.ok(member.received('rooms'));
    member.close(); outsider.close();
  });
});

describe('账号模式下的群管理', () => {
  let space;
  before(async () => { space = await startCloud(); });
  after(() => space.close());

  test('群主可以改名，成员可以退出', async () => {
    const alice = await space.member('Alice'), bob = await space.member('Bob');
    const id = (await alice.post('/api/rooms', { name: '云端群', memberIds: [bob.id] })).body.id;
    assert.equal((await alice.post('/api/room-settings', { roomId: id, name: '云端群2' })).status, 200);
    assert.equal((await bob.post('/api/room-leave', { roomId: id })).status, 200);
  });
});
