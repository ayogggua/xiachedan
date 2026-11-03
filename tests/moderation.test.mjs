import assert from 'node:assert/strict';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, test } from 'node:test';
import { send, settle, startCloud, startLocal } from './helpers.mjs';

describe('禁言', () => {
  let space, alice, bob;
  before(async () => {
    space = await startLocal();
    alice = await space.join('Alice');
    bob = await space.join('Bob');
  });
  after(() => space.close());

  test('禁言后不能发消息、发投票和转发，解除后恢复；自己能看到禁言状态', async () => {
    assert.equal((await space.owner.post('/api/admin/mute', { userId: alice.id, minutes: 60 })).status, 200);
    assert.equal((await send(alice, 'lobby', '还能说话吗')).status, 403);
    assert.equal((await alice.post('/api/polls', { roomId: 'lobby', question: '问', options: ['甲', '乙'] })).status, 403);
    const me = (await alice.get('/api/state')).body.me;
    assert.equal(me.muted, true);
    assert.ok(me.mutedUntil > Date.now());
    assert.equal((await bob.get('/api/state')).body.users.find(user => user.id === alice.id).muted, true);
    await space.owner.post('/api/admin/mute', { userId: alice.id, muted: false });
    assert.equal((await send(alice, 'lobby', '恢复了')).status, 201);
  });

  test('一直禁言；普通成员不能禁言别人；不能禁言空间创建者或自己', async () => {
    await space.owner.post('/api/admin/mute', { userId: bob.id });
    assert.equal((await bob.get('/api/state')).body.me.mutedUntil, null);
    assert.equal((await bob.get('/api/state')).body.me.muted, true);
    assert.equal((await alice.post('/api/admin/mute', { userId: bob.id, muted: false })).status, 403);
    assert.equal((await space.owner.post('/api/admin/mute', { userId: space.ownerId })).status, 400);
    const actions = (await space.owner.get('/api/admin/audit')).body.entries.map(entry => entry.action);
    assert.ok(actions.includes('mute') && actions.includes('unmute'));
  });
});

describe('消息保留期限', () => {
  let space, alice;
  before(async () => {
    space = await startLocal({ scheduleInterval: 50 });
    alice = await space.join('Alice');
  });
  after(() => space.close());

  test('超过保留期限的消息被自动删除，未过期的保留', async () => {
    const old = (await send(alice, 'lobby', '很久以前的消息')).body.message;
    await send(alice, 'lobby', '新消息');
    const db = new DatabaseSync(path.join(space.dataDir, 'chat.sqlite'));
    db.prepare('UPDATE messages SET created_at=? WHERE id=?').run(Date.now() - 40 * 86400000, old.id);
    db.close();
    assert.equal((await alice.post('/api/admin/retention', { days: 30 })).status, 403);
    assert.equal((await space.owner.post('/api/admin/retention', { days: 30 })).status, 200);
    assert.equal((await space.owner.post('/api/admin/retention', { days: 7 })).status, 400);
    await settle(300);
    const texts = (await alice.get('/api/messages?roomId=lobby')).body.messages.map(message => message.text);
    assert.deepEqual(texts, ['新消息']);
    assert.equal((await alice.get('/api/state')).body.workspace.retentionDays, 30);
  });
});

describe('账号模式的禁言', () => {
  let space;
  before(async () => { space = await startCloud(); });
  after(() => space.close());

  test('管理员可以禁言普通成员，但不能禁言其他管理员', async () => {
    const alice = await space.member('Alice');
    const bob = await space.member('Bob');
    await space.admin.post('/api/admin/role', { userId: bob.id, role: 'admin' });
    assert.equal((await space.admin.post('/api/admin/mute', { userId: alice.id, minutes: 10 })).status, 200);
    assert.equal((await send(alice, 'lobby', '说话')).status, 403);
    assert.equal((await space.admin.post('/api/admin/mute', { userId: bob.id })).status, 403);
  });
});
