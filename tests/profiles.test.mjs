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

describe('名字颜色', () => {
  let space, alice, bob;
  before(async () => {
    space = await startLocal();
    alice = await space.join('Alice');
    bob = await space.join('Bob');
  });
  after(() => space.close());

  test('可以选 7 种颜色之一，其他人看得到；null 恢复自动；无效值被拒绝', async () => {
    await alice.post('/api/profile', { name: 'Alice', nameColor: 3 });
    assert.equal((await bob.get('/api/state')).body.users.find(user => user.id === alice.id).nameColor, 3);
    await alice.post('/api/profile', { name: 'Alice' });
    assert.equal((await bob.get('/api/state')).body.users.find(user => user.id === alice.id).nameColor, 3);
    await alice.post('/api/profile', { name: 'Alice', nameColor: null });
    assert.equal((await bob.get('/api/state')).body.users.find(user => user.id === alice.id).nameColor, null);
    assert.equal((await alice.post('/api/profile', { name: 'Alice', nameColor: 9 })).status, 400);
  });
});

describe('管理员设置成员部门', () => {
  let space, alice, bob;
  before(async () => {
    space = await startLocal();
    alice = await space.join('Alice');
    bob = await space.join('Bob');
  });
  after(() => space.close());

  test('空间创建者可以改成员部门，所有人看到；普通成员不行', async () => {
    assert.equal((await alice.post('/api/admin/department', { userId: bob.id, department: '研发部' })).status, 403);
    const saved = await space.owner.post('/api/admin/department', { userId: bob.id, department: '  研发部 ' });
    assert.equal(saved.status, 200);
    assert.equal((await alice.get('/api/state')).body.users.find(user => user.id === bob.id).department, '研发部');
    assert.equal((await space.owner.post('/api/admin/department', { userId: 'missing', department: 'x' })).status, 400);
  });
});
