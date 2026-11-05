import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { send, startLocal } from './helpers.mjs';

describe('全员禁言', () => {
  let space, owner, admin, bob, group;
  before(async () => {
    space = await startLocal();
    owner = await space.join('Owner');
    admin = await space.join('Admin');
    bob = await space.join('Bob');
    group = (await owner.post('/api/rooms', { name: '禁言', memberIds: [admin.id, bob.id] })).body.id;
    await owner.post('/api/room-admins', { roomId: group, userId: admin.id, admin: true });
  });
  after(() => space.close());

  test('群主和管理员能开关，普通成员不能', async () => {
    assert.equal((await bob.post('/api/room-policy', { roomId: group, allMuted: true })).status, 403);
    assert.equal((await owner.post('/api/room-policy', { roomId: group, allMuted: 'yes' })).status, 400);
    const muted = await admin.post('/api/room-policy', { roomId: group, allMuted: true });
    assert.equal(muted.status, 200);
    assert.equal(muted.body.allMuted, true);
    assert.equal((await bob.get('/api/state')).body.rooms.find(room => room.id === group).allMuted, true);
  });

  test('开启后普通成员不能发消息、拍一拍、发投票、转发进来、建定时消息；群主和管理员照常；可以回应', async () => {
    const blocked = await send(bob, group, '能发吗');
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.error, '全员禁言中，只有群主和管理员可以发言');
    assert.equal((await bob.post('/api/nudge', { roomId: group, userId: owner.id })).status, 403);
    assert.equal((await bob.post('/api/polls', { roomId: group, question: '投吗', options: ['是', '否'] })).status, 403);
    const elsewhere = (await send(bob, 'lobby', '大厅里的话')).body.message;
    assert.equal((await bob.post('/api/forward', { roomId: group, messageIds: [elsewhere.id] })).status, 403);
    assert.equal((await bob.post('/api/scheduled', { roomId: group, text: '晚点发', sendAt: Date.now() + 3600000 })).status, 403);
    const ownerMessage = (await send(owner, group, '群主可以说话')).body.message;
    assert.equal((await send(admin, group, '管理员也可以')).status, 201);
    assert.equal((await bob.post('/api/reactions', { messageId: ownerMessage.id, emoji: '👍' })).status, 200);
    assert.equal((await send(bob, 'lobby', '别的会话不受影响')).status, 201);
  });

  test('关闭后恢复发言', async () => {
    await owner.post('/api/room-policy', { roomId: group, allMuted: false });
    assert.equal((await send(bob, group, '解禁了')).status, 201);
  });
});
