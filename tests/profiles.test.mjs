import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { listen, settle, startLocal } from './helpers.mjs';

describe('个人资料与最后在线', () => {
  let space, alice, bob;
  before(async () => {
    space = await startLocal();
    alice = await space.join('Alice');
    bob = await space.join('Bob');
  });
  after(() => space.close());

  test('可以填部门和签名，其他人在成员列表里看到；不传时保持原样', async () => {
    const saved = await alice.post('/api/profile', { name: 'Alice', department: '设计部', bio: '专注体验' });
    assert.equal(saved.body.me.department, '设计部');
    const seen = (await bob.get('/api/state')).body.users.find(user => user.id === alice.id);
    assert.equal(seen.department, '设计部');
    assert.equal(seen.bio, '专注体验');
    await alice.post('/api/profile', { name: 'Alice 2' });
    assert.equal((await bob.get('/api/state')).body.users.find(user => user.id === alice.id).department, '设计部');
    await alice.post('/api/profile', { name: 'Alice', department: 'x'.repeat(60) });
    assert.equal((await bob.get('/api/state')).body.users.find(user => user.id === alice.id).department.length, 40);
  });

  test('最后一个连接断开时记下最后在线时间', async () => {
    const before = Date.now();
    const live = await listen(space.base, bob);
    assert.equal((await alice.get('/api/state')).body.users.find(user => user.id === bob.id).online, true);
    live.close();
    await settle(200);
    const bobView = (await alice.get('/api/state')).body.users.find(user => user.id === bob.id);
    assert.equal(bobView.online, false);
    assert.ok(bobView.lastSeen >= before);
  });
});
