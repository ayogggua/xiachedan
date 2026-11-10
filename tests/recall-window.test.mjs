import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { send, startCloud, startLocal } from './helpers.mjs';

describe('撤回时限', () => {
  let space, bob;
  before(async () => { space = await startLocal(); bob = await space.join('Bob'); });
  after(() => space.close());
  // 把消息的发送时间往前拨，模拟过了一段时间。
  const age = (id, ms) => { const db = new DatabaseSync(path.join(space.dataDir, 'chat.sqlite')); db.prepare('UPDATE messages SET created_at=created_at-? WHERE id=?').run(ms, id); db.close(); };

  test('默认不限：很久以前的消息也能撤回', async () => {
    const id = (await send(bob, 'lobby', '旧消息')).body.message.id;
    age(id, 30 * 86400000);
    assert.equal((await bob.post('/api/recall-message', { messageId: id })).status, 200);
  });

  test('设为 2 分钟后，超时的不能撤回，时限内的可以；编辑不受影响', async () => {
    assert.equal((await space.owner.post('/api/admin/recall-window', { seconds: 120 })).status, 200);
    assert.equal((await bob.get('/api/state')).body.workspace.recallWindow, 120);
    const old = (await send(bob, 'lobby', '三分钟前')).body.message.id;
    age(old, 3 * 60000);
    const blocked = await bob.post('/api/recall-message', { messageId: old });
    assert.equal(blocked.status, 400);
    assert.equal(blocked.body.error, '超过 2 分钟的消息不能撤回');
    assert.equal((await bob.post('/api/edit-message', { messageId: old, text: '还能改' })).status, 200);
    const fresh = (await send(bob, 'lobby', '刚发的')).body.message.id;
    assert.equal((await bob.post('/api/recall-message', { messageId: fresh })).status, 200);
    const audit = (await space.owner.get('/api/admin/audit')).body.entries[0];
    assert.equal(audit.action, 'recall-window');
    assert.equal(audit.detail, '2 分钟');
  });

  test('只有管理者能改，只能选给定的几档', async () => {
    assert.equal((await bob.post('/api/admin/recall-window', { seconds: 0 })).status, 403);
    assert.equal((await space.owner.post('/api/admin/recall-window', { seconds: 60 })).status, 400);
    assert.equal((await space.owner.post('/api/admin/recall-window', { seconds: 86400 })).status, 200);
    assert.equal((await space.owner.post('/api/admin/recall-window', { seconds: 0 })).status, 200);
  });
});

describe('撤回时限（账号模式）', () => {
  let space;
  before(async () => { space = await startCloud(); });
  after(() => space.close());
  test('管理员可以设置，普通成员不行', async () => {
    const alice = await space.member('Alice');
    assert.equal((await alice.post('/api/admin/recall-window', { seconds: 120 })).status, 403);
    assert.equal((await space.admin.post('/api/admin/recall-window', { seconds: 120 })).status, 200);
    assert.equal((await alice.get('/api/state')).body.workspace.recallWindow, 120);
  });
});
