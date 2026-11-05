import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { startLocal } from './helpers.mjs';

describe('群邀请链接与入群审批', () => {
  let space, owner, admin, bob, carol, dave, eve, group;
  const roomOf = async member => (await member.get('/api/state')).body.rooms.find(item => item.id === group);
  before(async () => {
    space = await startLocal();
    [owner, admin, bob, carol, dave, eve] = [];
    owner = await space.join('Owner'); admin = await space.join('Admin'); bob = await space.join('Bob');
    carol = await space.join('Carol'); dave = await space.join('Dave'); eve = await space.join('Eve');
    group = (await owner.post('/api/rooms', { name: '邀请', memberIds: [admin.id, bob.id] })).body.id;
    await owner.post('/api/room-admins', { roomId: group, userId: admin.id, admin: true });
  });
  after(() => space.close());

  test('群主和管理员能生成链接，令牌只有他们看得到；用链接直接入群；停用后失效', async () => {
    assert.equal((await bob.post('/api/room-invite', { roomId: group, action: 'create' })).status, 403);
    const { inviteToken } = (await admin.post('/api/room-invite', { roomId: group, action: 'create' })).body;
    assert.match(inviteToken, /^[\w-]{20,}$/);
    assert.equal((await roomOf(owner)).inviteToken, inviteToken);
    assert.equal((await roomOf(bob)).inviteToken, undefined);
    assert.equal((await carol.post('/api/room-join', { roomId: group, token: 'wrong-token-value' })).status, 404);
    const joined = await carol.post('/api/room-join', { roomId: group, token: inviteToken });
    assert.deepEqual(joined.body, { joined: true, roomId: group });
    assert.ok((await roomOf(owner)).members.includes(carol.id));
    await owner.post('/api/room-invite', { roomId: group, action: 'disable' });
    assert.equal((await dave.post('/api/room-join', { roomId: group, token: inviteToken })).status, 404);
  });

  test('开了入群审批：链接申请和普通成员拉人都进申请列表；管理员拉人直接进；同意或拒绝', async () => {
    assert.equal((await bob.post('/api/room-policy', { roomId: group, joinApproval: true })).status, 403);
    await owner.post('/api/room-policy', { roomId: group, joinApproval: true });
    const { inviteToken } = (await owner.post('/api/room-invite', { roomId: group, action: 'create' })).body;
    assert.deepEqual((await dave.post('/api/room-join', { roomId: group, token: inviteToken })).body, { pending: true });
    assert.equal((await dave.get(`/api/messages?roomId=${group}`)).status, 403);
    assert.deepEqual((await bob.post('/api/room-members', { roomId: group, memberIds: [eve.id] })).body, { ok: true, pending: 1 });
    const requests = (await roomOf(admin)).joinRequests;
    assert.deepEqual(requests.map(item => [item.userId, item.invitedBy]), [[dave.id, null], [eve.id, bob.id]]);
    assert.equal((await roomOf(bob)).joinRequests, undefined);
    assert.equal((await bob.post('/api/room-requests', { roomId: group, requestId: requests[0].id, approve: true })).status, 403);
    await admin.post('/api/room-requests', { roomId: group, requestId: requests[0].id, approve: true });
    await owner.post('/api/room-requests', { roomId: group, requestId: requests[1].id, approve: false });
    const after = await roomOf(owner);
    assert.ok(after.members.includes(dave.id));
    assert.ok(!after.members.includes(eve.id));
    assert.deepEqual(after.joinRequests, []);
    assert.equal((await admin.post('/api/room-requests', { roomId: group, requestId: requests[1].id, approve: true })).status, 404);
    assert.equal((await admin.post('/api/room-members', { roomId: group, memberIds: [eve.id] })).body.pending, undefined);
    assert.ok((await roomOf(owner)).members.includes(eve.id));
  });
});
